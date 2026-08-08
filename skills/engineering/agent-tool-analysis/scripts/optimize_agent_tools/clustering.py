"""Tool co-usage clustering and boundary analysis."""

from __future__ import annotations

import statistics
from collections import Counter, defaultdict
from typing import Iterable

from .telemetry_ingestion import Session


def build_session_index(sessions: list[Session]) -> dict[str, set[int]]:
    index: dict[str, set[int]] = defaultdict(set)
    for i, session in enumerate(sessions):
        for tool in session.tool_set:
            index[tool].add(i)
    return dict(index)


def pair_key(left: str, right: str) -> tuple[str, str]:
    return (left, right) if left <= right else (right, left)


def build_adjacency_counts(sessions: list[Session]) -> Counter[tuple[str, str]]:
    counts: Counter[tuple[str, str]] = Counter()
    for session in sessions:
        for left, right in zip(session.calls, session.calls[1:]):
            if left != right:
                counts[pair_key(left, right)] += 1
    return counts


def pair_metrics(
    a: str,
    b: str,
    session_index: dict[str, set[int]],
    adjacency: Counter[tuple[str, str]],
) -> dict[str, float]:
    sa = session_index.get(a, set())
    sb = session_index.get(b, set())
    intersection = len(sa & sb)
    union = len(sa | sb)
    jaccard = intersection / union if union else 0.0
    min_support = min(len(sa), len(sb))
    overlap = intersection / min_support if min_support else 0.0
    adjacent = adjacency[pair_key(a, b)]
    adjacency_rate = min(1.0, adjacent / min_support) if min_support else 0.0
    return {
        "co_sessions": intersection,
        "jaccard": jaccard,
        "overlap": overlap,
        "adjacency_count": adjacent,
        "adjacency_rate": adjacency_rate,
        "affinity": 0.55 * jaccard + 0.30 * overlap + 0.15 * adjacency_rate,
    }


def all_pair_metrics(
    active_tools: list[str],
    session_index: dict[str, set[int]],
    adjacency: Counter[tuple[str, str]],
) -> dict[tuple[str, str], dict[str, float]]:
    return {
        (a, b): pair_metrics(a, b, session_index, adjacency)
        for i, a in enumerate(active_tools)
        for b in active_tools[i + 1 :]
    }


def cluster_affinity(
    left: set[str], right: set[str], pairs: dict[tuple[str, str], dict[str, float]]
) -> float:
    values = [
        pairs[pair_key(a, b)]["affinity"]
        for a in left
        for b in right
        if pair_key(a, b) in pairs
    ]
    return statistics.fmean(values) if values else 0.0


def agglomerative_clusters(
    tools: list[str], pairs: dict[tuple[str, str], dict[str, float]], threshold: float
) -> list[set[str]]:
    clusters = [{tool} for tool in tools]
    while len(clusters) > 1:
        best_score = -1.0
        best_pair: tuple[int, int] | None = None
        for i in range(len(clusters)):
            for j in range(i + 1, len(clusters)):
                score = cluster_affinity(clusters[i], clusters[j], pairs)
                if score > best_score:
                    best_score, best_pair = score, (i, j)
        if best_pair is None or best_score < threshold:
            break
        i, j = best_pair
        merged = clusters[i] | clusters[j]
        clusters = [cluster for k, cluster in enumerate(clusters) if k not in {i, j}]
        clusters.append(merged)
    return sorted(clusters, key=lambda cluster: (-len(cluster), sorted(cluster)))


def cluster_internal_affinity(
    cluster: set[str], pairs: dict[tuple[str, str], dict[str, float]]
) -> float:
    values = [
        pairs[pair_key(a, b)]["affinity"]
        for i, a in enumerate(sorted(cluster))
        for b in sorted(cluster)[i + 1 :]
        if pair_key(a, b) in pairs
    ]
    return statistics.fmean(values) if values else 0.0


def tool_boundary_metrics(
    tool: str,
    cluster: set[str],
    pairs: dict[tuple[str, str], dict[str, float]],
    all_clustered_tools: Iterable[str],
) -> dict[str, float]:
    internal = [
        pairs[pair_key(tool, other)]["affinity"]
        for other in cluster
        if other != tool and pair_key(tool, other) in pairs
    ]
    external = [
        pairs[pair_key(tool, other)]["affinity"]
        for other in all_clustered_tools
        if other not in cluster and pair_key(tool, other) in pairs
    ]
    mean_internal = statistics.fmean(internal) if internal else 0.0
    best_external = max(external) if external else 0.0
    return {
        "mean_internal_affinity": mean_internal,
        "best_external_affinity": best_external,
        "boundary_margin": mean_internal - best_external,
    }


def cluster_boundary_metrics(
    cluster: set[str],
    clusters: list[set[str]],
    pairs: dict[tuple[str, str], dict[str, float]],
    all_clustered_tools: Iterable[str],
    session_index: dict[str, set[int]],
    sessions: list[Session],
) -> dict[str, float]:
    tool_metrics = [
        tool_boundary_metrics(tool, cluster, pairs, all_clustered_tools)
        for tool in cluster
    ]
    external = [
        metric["best_external_affinity"]
        for metric in tool_metrics
        if metric["best_external_affinity"] > 0
    ]
    covered = set().union(*(session_index.get(tool, set()) for tool in cluster))
    cluster_session_sets = [
        set().union(*(session_index.get(tool, set()) for tool in candidate))
        for candidate in clusters
    ]
    position = clusters.index(cluster)
    other_sessions = set().union(
        *(value for i, value in enumerate(cluster_session_sets) if i != position)
    )
    return {
        "internal_affinity": cluster_internal_affinity(cluster, pairs),
        "max_external_affinity": max(external) if external else 0.0,
        "mean_boundary_margin": statistics.fmean(
            metric["boundary_margin"] for metric in tool_metrics
        )
        if tool_metrics
        else 0.0,
        "session_coverage": len(covered) / len(sessions) if sessions else 0.0,
        "exclusive_session_coverage": len(covered - other_sessions) / len(sessions)
        if sessions
        else 0.0,
        "overlapping_session_coverage": len(covered & other_sessions) / len(sessions)
        if sessions
        else 0.0,
    }
