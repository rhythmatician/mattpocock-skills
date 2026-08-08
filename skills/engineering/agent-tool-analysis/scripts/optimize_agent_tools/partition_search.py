"""Label-free candidate partition search over observed tool sessions."""

from __future__ import annotations

from dataclasses import asdict, dataclass, replace
from typing import Any, Iterable, Mapping

from optimize_agent_tools.exposure_models import (
    BaselineExposure,
    baseline_exposure_states,
)
from optimize_agent_tools.replay_harness import (
    BASELINE_ARCHITECTURE_ID,
)
from optimize_agent_tools.telemetry_ingestion import (
    Session,
)

PARETO_DIMENSIONS = (
    "expected_context_cost_after_communication",
    "max_agent_definition_cost",
    "cross_agent_session_frequency",
    "expected_handoff_count",
    "agent_count",
)


@dataclass(frozen=True)
class PartitionCandidate:
    """One generic architecture generated from the observed tool graph."""

    architecture_id: str
    agent_tools: tuple[tuple[str, ...], ...]
    parent_tools: tuple[str, ...]
    agent_definition_costs: tuple[float | None, ...]
    historical_activation_rates: tuple[float, ...]
    cross_agent_session_frequency: float
    expected_handoff_count: float
    expected_delegation_count: float
    expected_context_cost_before_communication: float | None
    expected_context_cost_after_communication: float | None
    max_agent_definition_cost: float | None
    cross_agent_edge_weight: float
    dependency_closed: bool
    is_cost_complete: bool
    is_pareto_optimal: bool = False
    pareto_scope: str = "global"

    @property
    def agent_count(self) -> int:
        return len(self.agent_tools)


@dataclass(frozen=True)
class PartitionSearchResult:
    """All generated candidates, the retained frontier, and replay manifest."""

    all_candidates: tuple[PartitionCandidate, ...]
    pareto_candidates: tuple[PartitionCandidate, ...]
    manifest: dict[str, Any]
    report: dict[str, Any]
    search_complete: bool
    pareto_scope: str
    search_strategy: str


@dataclass(frozen=True)
class _Graph:
    tools: tuple[str, ...]
    pair_weights: Mapping[tuple[str, str], float]
    total_sessions: int
    total_calls: int


def _strings(values: Iterable[str], field_name: str) -> frozenset[str]:
    if isinstance(values, (str, bytes)):
        raise ValueError(f"{field_name} must contain strings, not a scalar.")
    result = frozenset(values)
    if not all(isinstance(value, str) and value for value in result):
        raise ValueError(f"{field_name} must contain non-empty strings.")
    return result


def _cost(stat: Any) -> float | None:
    if isinstance(stat, (int, float)) and not isinstance(stat, bool):
        return float(stat)
    for field in ("definition_tokens", "estimated_cost_mid"):
        value = getattr(stat, field, None)
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            return float(value)
    return None


def _sum_known(costs: Iterable[float | None]) -> float | None:
    values = list(costs)
    return (
        sum(value for value in values if value is not None)
        if all(value is not None for value in values)
        else None
    )


def _pair_key(left: str, right: str) -> tuple[str, str]:
    return (left, right) if left <= right else (right, left)


def _observed_surface(session: Session, exposure: BaselineExposure) -> set[str] | None:
    if (
        session.exposure_source == "not_observed"
        and not session.exposed_tools
        and not exposure.inferred_baseline_exposure
    ):
        return None
    return set(exposure.exposed_tools)


def _build_graph(sessions: list[Session], tools: frozenset[str]) -> _Graph:
    total_sessions = len(sessions)
    total_calls = sum(len(session.calls) for session in sessions)
    co_sessions: dict[tuple[str, str], int] = {}
    adjacency: dict[tuple[str, str], int] = {}
    for session in sessions:
        session_tools = sorted(session.tool_set & tools)
        for index, left in enumerate(session_tools):
            for right in session_tools[index + 1 :]:
                key = _pair_key(left, right)
                co_sessions[key] = co_sessions.get(key, 0) + 1
        for left, right in zip(session.calls, session.calls[1:]):
            if left != right and left in tools and right in tools:
                key = _pair_key(left, right)
                adjacency[key] = adjacency.get(key, 0) + 1
    weights = {
        key: (co_sessions.get(key, 0) / total_sessions if total_sessions else 0.0)
        + (adjacency.get(key, 0) / total_calls if total_calls else 0.0)
        for key in set(co_sessions) | set(adjacency)
    }
    return _Graph(tuple(sorted(tools)), weights, total_sessions, total_calls)


def _dependency_closure(
    roots: Iterable[str], dependencies: Mapping[str, Iterable[str]]
) -> frozenset[str]:
    retained = set(roots)
    pending = list(retained)
    while pending:
        tool = pending.pop()
        for dependency in dependencies.get(tool, ()):
            if dependency not in retained:
                retained.add(dependency)
                pending.append(dependency)
    return frozenset(retained)


def _dependency_units(
    tools: frozenset[str],
    dependencies: Mapping[str, Iterable[str]],
    global_tools: frozenset[str],
) -> tuple[frozenset[str], ...]:
    """Make disjoint units so every partition is dependency closed."""
    specialist_tools = set(tools - global_tools)
    parent: dict[str, str] = {tool: tool for tool in specialist_tools}

    def find(tool: str) -> str:
        while parent[tool] != tool:
            parent[tool] = parent[parent[tool]]
            tool = parent[tool]
        return tool

    def union(left: str, right: str) -> None:
        if left in parent and right in parent:
            left_root, right_root = find(left), find(right)
            if left_root != right_root:
                parent[right_root] = left_root

    for tool in specialist_tools:
        for dependency in dependencies.get(tool, ()):
            if dependency in specialist_tools:
                union(tool, dependency)
    groups: dict[str, set[str]] = {}
    for tool in sorted(specialist_tools):
        groups.setdefault(find(tool), set()).add(tool)
    return tuple(frozenset(groups[key]) for key in sorted(groups))


def _unit_affinity(left: frozenset[str], right: frozenset[str], graph: _Graph) -> float:
    values = [graph.pair_weights.get(_pair_key(a, b), 0.0) for a in left for b in right]
    return sum(values) / len(values) if values else 0.0


def _set_partitions(
    units: tuple[frozenset[str], ...], agent_count: int
) -> Iterable[tuple[tuple[frozenset[str], ...], ...]]:
    if agent_count == 1:
        yield (units,)
        return
    if len(units) == agent_count:
        yield tuple((unit,) for unit in units)
        return
    first, rest = units[0], units[1:]
    for partition in _set_partitions(rest, agent_count - 1):
        yield ((first,), *partition)
    for partition in _set_partitions(rest, agent_count):
        for index in range(agent_count):
            yield (
                partition[:index]
                + ((first, *partition[index]),)
                + partition[index + 1 :]
            )


def _stirling_second_kind(item_count: int, agent_count: int) -> int:
    table = [[0] * (agent_count + 1) for _ in range(item_count + 1)]
    table[0][0] = 1
    for item in range(1, item_count + 1):
        for count in range(1, min(item, agent_count) + 1):
            table[item][count] = (
                table[item - 1][count - 1] + count * table[item - 1][count]
            )
    return table[item_count][agent_count]


def _heuristic_partitions(
    units: tuple[frozenset[str], ...],
    agent_count: int,
    graph: _Graph,
    limit: int,
) -> tuple[tuple[tuple[frozenset[str], ...], ...], ...]:
    """Generate deterministic affinity-guided partitions when exhaustive search is large."""
    if agent_count == 1:
        return ((units,),)
    seeds = tuple(sorted(units, key=lambda unit: (len(unit), tuple(sorted(unit)))))
    seeds = seeds[:agent_count]
    partitions: set[tuple[tuple[frozenset[str], ...], ...]] = set()
    for seed_offset in range(min(len(units), limit)):
        ordered = units[seed_offset:] + units[:seed_offset]
        initial = list(ordered[:agent_count])
        groups = [[unit] for unit in initial]
        for unit in ordered[agent_count:]:
            index = max(
                range(agent_count),
                key=lambda candidate: (
                    sum(
                        _unit_affinity(unit, member, graph)
                        for member in groups[candidate]
                    ),
                    -candidate,
                ),
            )
            groups[index].append(unit)
        canonical = tuple(
            tuple(sorted(group, key=lambda unit: tuple(sorted(unit))))
            for group in sorted(groups, key=lambda group: tuple(sorted(group[0])))
        )
        partitions.add(canonical)
        if len(partitions) >= limit:
            break
    return tuple(sorted(partitions, key=str))


def _partition_tools(
    partition: tuple[tuple[frozenset[str], ...], ...],
) -> tuple[tuple[str, ...], ...]:
    return tuple(
        tuple(sorted(tool for unit in group for tool in unit)) for group in partition
    )


def _partition_edge_weight(
    agent_tools: tuple[tuple[str, ...], ...], graph: _Graph
) -> float:
    total = 0.0
    for left_index, left in enumerate(agent_tools):
        for right in agent_tools[left_index + 1 :]:
            total += sum(
                graph.pair_weights.get(_pair_key(a, b), 0.0)
                for a in left
                for b in right
            )
    return total


def _is_dependency_closed(
    agent_tools: tuple[tuple[str, ...], ...],
    parent_tools: frozenset[str],
    dependencies: Mapping[str, Iterable[str]],
) -> bool:
    surface = parent_tools | frozenset(tool for tools in agent_tools for tool in tools)
    ownership = {
        tool: index for index, tools in enumerate(agent_tools) for tool in tools
    }
    for tool in surface:
        for dependency in dependencies.get(tool, ()):
            if dependency not in surface:
                return False
            if (
                tool in ownership
                and dependency in ownership
                and ownership[tool] != ownership[dependency]
            ):
                return False
    return True


def _candidate_metrics(
    architecture_id: str,
    agent_tools: tuple[tuple[str, ...], ...],
    parent_tools: frozenset[str],
    sessions: list[Session],
    stats: Mapping[str, Any],
    retained_tools: frozenset[str],
    graph: _Graph,
    dependencies: Mapping[str, Iterable[str]],
    delegation_tokens: float,
    communication_tokens: float,
    exposure_model: str,
) -> PartitionCandidate:
    costs: tuple[float | None, ...] = tuple(
        _sum_known(_cost(stats.get(tool)) for tool in tools) for tools in agent_tools
    )
    ownership = {
        tool: index for index, tools in enumerate(agent_tools) for tool in tools
    }
    activation_counts = [0] * len(agent_tools)
    cross_sessions = 0
    handoffs = 0
    delegation_count = 0
    exposure_states = baseline_exposure_states(sessions, exposure_model)
    context_before: list[float | None] = []
    context_after: list[float | None] = []
    for session in sessions:
        called_agents = {ownership[tool] for tool in session.calls if tool in ownership}
        for index in called_agents:
            activation_counts[index] += 1
        if len(called_agents) > 1:
            cross_sessions += 1
        ordered_agents = [
            ownership[tool] for tool in session.calls if tool in ownership
        ]
        handoffs += sum(
            left != right for left, right in zip(ordered_agents, ordered_agents[1:])
        )
        delegation_count += max(len(called_agents) - 1, 0)

        surface = _observed_surface(session, exposure_states[session.session_id])
        if surface is None:
            context_before.append(None)
            context_after.append(None)
            continue
        before_costs = [_cost(stats.get(tool)) for tool in surface & retained_tools]
        context_before.append(_sum_known(before_costs))
        parent_costs = [_cost(stats.get(tool)) for tool in surface & parent_tools]
        active_costs = [costs[index] for index in called_agents]
        context_after.append(_sum_known(parent_costs + active_costs))

    session_count = len(sessions)
    rates = tuple(
        count / session_count if session_count else 0.0 for count in activation_counts
    )
    before_cost = (
        sum(value for value in context_before if value is not None) / session_count
        if session_count and all(value is not None for value in context_before)
        else None
    )
    after = (
        sum(value for value in context_after if value is not None) / session_count
        if session_count and all(value is not None for value in context_after)
        else None
    )
    expected_handoffs = handoffs / session_count if session_count else 0.0
    expected_delegations = delegation_count / session_count if session_count else 0.0
    after_communication = (
        after
        + expected_delegations * delegation_tokens
        + expected_handoffs * communication_tokens
        if after is not None
        else None
    )
    complete = (
        all(cost is not None for cost in costs) and after_communication is not None
    )
    return PartitionCandidate(
        architecture_id=architecture_id,
        agent_tools=agent_tools,
        parent_tools=tuple(sorted(parent_tools)),
        agent_definition_costs=costs,
        historical_activation_rates=rates,
        cross_agent_session_frequency=(
            cross_sessions / session_count if session_count else 0.0
        ),
        expected_handoff_count=expected_handoffs,
        expected_delegation_count=expected_delegations,
        expected_context_cost_before_communication=before_cost,
        expected_context_cost_after_communication=after_communication,
        max_agent_definition_cost=(
            max(cost for cost in costs if cost is not None)
            if complete and costs
            else None
        ),
        cross_agent_edge_weight=_partition_edge_weight(agent_tools, graph),
        dependency_closed=_is_dependency_closed(
            agent_tools, parent_tools, dependencies
        ),
        is_cost_complete=complete,
    )


def _pareto(candidates: list[PartitionCandidate]) -> tuple[PartitionCandidate, ...]:
    eligible = [candidate for candidate in candidates if candidate.is_cost_complete]
    frontier: list[PartitionCandidate] = []
    for candidate in eligible:
        dominated = any(
            all(
                getattr(other, key) <= getattr(candidate, key)
                for key in PARETO_DIMENSIONS
            )
            and any(
                getattr(other, key) < getattr(candidate, key)
                for key in PARETO_DIMENSIONS
            )
            for other in eligible
            if other.architecture_id != candidate.architecture_id
        )
        if not dominated:
            frontier.append(candidate)
    frontier.sort(key=lambda candidate: candidate.architecture_id)
    return tuple(frontier)


def _candidate_dict(candidate: PartitionCandidate) -> dict[str, Any]:
    return asdict(candidate) | {
        "agent_count": candidate.agent_count,
        "agent_tools": [list(tools) for tools in candidate.agent_tools],
    }


def search_partitions(
    *,
    sessions: Iterable[Session],
    stats: Mapping[str, Any],
    required_tools: Iterable[str] | None = None,
    global_tools: Iterable[str] = (),
    dependencies: Mapping[str, Iterable[str]] | None = None,
    max_agents: int = 3,
    communication_tokens_per_handoff: float = 0.0,
    delegation_tokens_per_activation: float = 0.0,
    max_exhaustive_units: int = 10,
    max_partition_candidates: int = 5000,
    baseline_tools: Iterable[str] | None = None,
    exposure_model: str = "observed_only",
) -> PartitionSearchResult:
    """Search generic, dependency-closed partitions and retain their Pareto frontier."""
    if max_agents < 1:
        raise ValueError("max_agents must be at least 1.")
    if max_exhaustive_units < 1 or max_partition_candidates < 1:
        raise ValueError("Partition search limits must be positive.")
    if communication_tokens_per_handoff < 0 or delegation_tokens_per_activation < 0:
        raise ValueError("Communication and delegation costs cannot be negative.")
    session_list = list(sessions)
    dependencies = {
        tool: _strings(values, f"dependencies.{tool}")
        for tool, values in (dependencies or {}).items()
    }
    global_set = _strings(global_tools, "global_tools")
    observed_tools = frozenset(
        tool for session in session_list for tool in session.tool_set
    )
    roots = (
        _strings(required_tools, "required_tools")
        if required_tools is not None
        else observed_tools
    )
    required_retained = _dependency_closure(roots, dependencies)
    global_surface = _dependency_closure(global_set, dependencies)
    retained = required_retained | global_surface
    baseline_surface = (
        _strings(baseline_tools, "baseline_tools")
        if baseline_tools is not None
        else retained
    )
    if not global_surface <= retained:
        raise ValueError("Global tools must be retained tools.")
    graph = _build_graph(session_list, retained)
    units = _dependency_units(retained, dependencies, global_surface)
    all_candidates: list[PartitionCandidate] = []
    complete = True
    exhaustive = True
    max_k = min(max_agents, len(units)) if units else (1 if retained else 0)
    for agent_count in range(1, max_k + 1):
        estimated = _stirling_second_kind(len(units), agent_count)
        if len(units) <= max_exhaustive_units and estimated <= max_partition_candidates:
            partitions = tuple(_set_partitions(units, agent_count))
        else:
            complete = False
            exhaustive = False
            partitions = _heuristic_partitions(
                units, agent_count, graph, max_partition_candidates
            )
        for index, partition in enumerate(partitions, start=1):
            tools = _partition_tools(partition)
            candidate = _candidate_metrics(
                f"partition_k{agent_count:02d}_{index:04d}",
                tools,
                global_surface,
                session_list,
                stats,
                retained,
                graph,
                dependencies,
                delegation_tokens_per_activation,
                communication_tokens_per_handoff,
                exposure_model,
            )
            all_candidates.append(candidate)
    frontier = _pareto(all_candidates)
    frontier_ids = {candidate.architecture_id for candidate in frontier}
    pareto_scope = "global" if exhaustive else "evaluated_subset"
    marked_all = tuple(
        replace(
            candidate,
            is_pareto_optimal=candidate.architecture_id in frontier_ids,
            pareto_scope=pareto_scope,
        )
        for candidate in all_candidates
    )
    marked_frontier = tuple(
        candidate for candidate in marked_all if candidate.is_pareto_optimal
    )
    architectures: list[dict[str, Any]] = [
        {
            "architecture_id": BASELINE_ARCHITECTURE_ID,
            "parent_tools": sorted(baseline_surface),
            "agents": {},
        }
    ]
    architectures.extend(
        {
            "architecture_id": candidate.architecture_id,
            "parent_tools": list(candidate.parent_tools),
            "agents": {
                f"agent_{index:02d}": list(tools)
                for index, tools in enumerate(candidate.agent_tools, start=1)
            },
        }
        for candidate in marked_frontier
    )
    search_provenance = {
        "search_complete": complete,
        "search_strategy": "exhaustive" if exhaustive else "bounded",
        "pareto_scope": pareto_scope,
    }
    manifest = {
        "baseline_architecture_id": BASELINE_ARCHITECTURE_ID,
        "historical_tool_capability_tools": sorted(required_retained),
        "search_provenance": search_provenance,
        "architectures": architectures,
    }
    report = {
        "search": {
            "max_agents": max_agents,
            "search_complete": complete,
            "exposure_model": exposure_model,
            "pareto_scope": pareto_scope,
            "search_strategy": "exhaustive" if exhaustive else "bounded",
            "partition_units": [sorted(unit) for unit in units],
            "global_tools": sorted(global_surface),
            "dependency_edges": {
                tool: sorted(values) for tool, values in sorted(dependencies.items())
            },
            "pareto_dimensions": list(PARETO_DIMENSIONS),
        },
        "candidates": [_candidate_dict(candidate) for candidate in marked_all],
        "pareto_candidate_ids": [
            candidate.architecture_id for candidate in marked_frontier
        ],
        "pareto_scope": pareto_scope,
        "search_strategy": "exhaustive" if exhaustive else "bounded",
        "search_provenance": search_provenance,
        "manifest": manifest,
    }
    return PartitionSearchResult(
        marked_all,
        marked_frontier,
        manifest,
        report,
        complete,
        pareto_scope,
        "exhaustive" if exhaustive else "bounded",
    )
