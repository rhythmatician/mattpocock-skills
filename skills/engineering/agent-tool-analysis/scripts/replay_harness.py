"""Replay/A-B harness for comparing frozen tool architectures."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable, Iterable, Mapping

PARETO_02_TOOLS = frozenset(
    {"github.add_review_to_pr", "github.reply_to_review_comment"}
)
PARETO_03_TOOLS = frozenset(
    {"github.fetch_file", "github.list_pr_changed_filenames"}
)
FROZEN_PRUNED_FLAT_BASELINE_TOOLS = frozenset(
    {
        "exec",
        "followup_task",
        "github.add_comment_to_issue",
        "github.add_issue_assignees",
        "github.add_review_to_pr",
        "github.create_issue",
        "github.create_pull_request",
        "github.fetch_file",
        "github.fetch_issue",
        "github.fetch_issue_comments",
        "github.fetch_pr",
        "github.fetch_pr_comments",
        "github.fetch_pr_patch",
        "github.get_pr_info",
        "github.get_user_login",
        "github.list_pr_changed_filenames",
        "github.list_pull_request_review_threads",
        "github.list_pull_request_reviews",
        "github.reply_to_review_comment",
        "github.resolve_review_thread",
        "github.search_prs",
        "github.update_issue",
        "github.update_pull_request",
        "interrupt_agent",
        "list_agents",
        "send_message",
        "spawn_agent",
        "wait",
        "wait_agent",
    }
)


@dataclass(frozen=True)
class ReplayTask:
    """A replayable task with an optional explicit specialist assignment."""

    task_id: str
    required_specialist: str | None = None


@dataclass(frozen=True)
class BenchmarkArchitecture:
    """A frozen parent/specialist tool surface under explicit routing."""

    architecture_id: str
    parent_tools: frozenset[str]
    specialist_tools: Mapping[str, frozenset[str]] = field(default_factory=dict)

    def route(self, task: ReplayTask) -> str | None:
        """Route only when the task explicitly names a supported specialist."""
        specialist = task.required_specialist
        if specialist is not None and specialist in self.specialist_tools:
            return specialist
        return None


@dataclass(frozen=True)
class ReplayObservation:
    """One executor's task-level result and measured operational counters."""

    task_id: str
    task_success: bool
    capability_covered: bool
    quality_score: float
    specialist_activated: str | None = None
    tool_call_failures: int = 0
    routing_failure: bool = False
    missed_specialist_activation: bool = False
    total_input_tokens: int = 0
    tool_definition_context_tokens: int = 0
    turns: int = 0
    wall_clock_seconds: float = 0.0


@dataclass(frozen=True)
class ReplayAggregate:
    """Aggregated task and operational measurements for one architecture."""

    task_count: int
    task_success_rate: float
    capability_coverage_rate: float
    mean_quality_score: float
    tool_call_failures: int
    routing_failures: int
    missed_specialist_activations: int
    unnecessary_specialist_activations: int
    total_input_tokens: int
    tool_definition_context_tokens: int
    turns: int
    specialist_handoffs: int
    wall_clock_seconds: float

    @property
    def total_tool_context_tokens(self) -> int:
        """Alias matching the benchmark's public metric name."""
        return self.tool_definition_context_tokens


@dataclass(frozen=True)
class ReplayResult:
    architecture_id: str
    observations: tuple[ReplayObservation, ...]
    aggregate: ReplayAggregate


@dataclass(frozen=True)
class BenchmarkComparison:
    baseline_architecture_id: str
    candidate_architecture_id: str
    passed: bool
    historical_capability_coverage_preserved: bool
    task_quality_preserved: bool
    context_tokens_reduced: bool
    capability_coverage_delta: float
    quality_delta: float
    context_tokens_delta: int

    @property
    def capability_coverage_preserved(self) -> bool:
        return self.historical_capability_coverage_preserved

    @property
    def quality_preserved(self) -> bool:
        return self.task_quality_preserved


def build_benchmark_architectures(
    parent_tools: Iterable[str],
) -> tuple[BenchmarkArchitecture, ...]:
    """Freeze the parent benchmark and the two named Pareto candidates."""
    baseline_tools = frozenset(parent_tools)
    candidates = {
        "pareto_02": PARETO_02_TOOLS,
        "pareto_03": PARETO_03_TOOLS,
    }
    architectures = [
        BenchmarkArchitecture("pruned_flat_baseline", baseline_tools),
    ]
    for architecture_id, specialist_tools in candidates.items():
        architectures.append(
            BenchmarkArchitecture(
                architecture_id,
                baseline_tools - specialist_tools,
                {architecture_id: specialist_tools},
            )
        )
    return tuple(architectures)


ReplayExecutor = Callable[
    [ReplayTask, BenchmarkArchitecture, str | None], ReplayObservation
]


def run_replay(
    tasks: Iterable[ReplayTask],
    architecture: BenchmarkArchitecture,
    executor: ReplayExecutor,
) -> ReplayResult:
    """Replay tasks through an architecture using its explicit route policy."""
    observations: list[ReplayObservation] = []
    routed_tasks: list[tuple[ReplayTask, str | None]] = []
    for task in tasks:
        specialist_id = architecture.route(task)
        routed_tasks.append((task, specialist_id))
        observation = executor(task, architecture, specialist_id)
        if observation.task_id != task.task_id:
            raise ValueError(
                f"Executor returned {observation.task_id!r} for {task.task_id!r}."
            )
        observations.append(observation)

    aggregate = _aggregate(architecture, routed_tasks, observations)
    return ReplayResult(architecture.architecture_id, tuple(observations), aggregate)


def _aggregate(
    architecture: BenchmarkArchitecture,
    routed_tasks: list[tuple[ReplayTask, str | None]],
    observations: list[ReplayObservation],
) -> ReplayAggregate:
    task_count = len(observations)
    if task_count == 0:
        mean_quality_score = 0.0
    else:
        mean_quality_score = sum(
            observation.quality_score for observation in observations
        ) / task_count

    actual_activations = [
        observation.specialist_activated for observation in observations
    ]
    unnecessary = sum(
        activated is not None and activated != expected_specialist
        for (task, expected_specialist), activated in zip(
            routed_tasks, actual_activations, strict=True
        )
    )
    routing_failures = sum(
        observation.routing_failure
        or (
            bool(architecture.specialist_tools)
            and task.required_specialist in architecture.specialist_tools
            and specialist_id is None
        )
        for (task, specialist_id), observation in zip(
            routed_tasks, observations, strict=True
        )
    )
    missed = sum(
        observation.missed_specialist_activation
        or (
            expected_specialist is not None
            and observation.specialist_activated != expected_specialist
        )
        for (task, expected_specialist), observation in zip(
            routed_tasks, observations, strict=True
        )
    )
    return ReplayAggregate(
        task_count=task_count,
        task_success_rate=(
            sum(observation.task_success for observation in observations) / task_count
            if task_count
            else 0.0
        ),
        capability_coverage_rate=(
            sum(observation.capability_covered for observation in observations)
            / task_count
            if task_count
            else 0.0
        ),
        mean_quality_score=mean_quality_score,
        tool_call_failures=sum(
            observation.tool_call_failures for observation in observations
        ),
        routing_failures=routing_failures,
        missed_specialist_activations=missed,
        unnecessary_specialist_activations=unnecessary,
        total_input_tokens=sum(
            observation.total_input_tokens for observation in observations
        ),
        turns=sum(observation.turns for observation in observations),
        specialist_handoffs=sum(
            activated in architecture.specialist_tools
            for activated in actual_activations
        ),
        wall_clock_seconds=sum(
            observation.wall_clock_seconds for observation in observations
        ),
        tool_definition_context_tokens=sum(
            observation.tool_definition_context_tokens
            for observation in observations
        ),
    )


def compare_to_benchmark(
    baseline: ReplayResult, candidate: ReplayResult
) -> BenchmarkComparison:
    """Apply the strict candidate-success benchmark gate."""
    capability_delta = (
        candidate.aggregate.capability_coverage_rate
        - baseline.aggregate.capability_coverage_rate
    )
    quality_delta = (
        candidate.aggregate.mean_quality_score
        - baseline.aggregate.mean_quality_score
    )
    context_delta = (
        candidate.aggregate.total_tool_context_tokens
        - baseline.aggregate.total_tool_context_tokens
    )
    capability_preserved = (
        candidate.aggregate.capability_coverage_rate == 1.0
        and capability_delta >= 0
    )
    quality_preserved = quality_delta >= 0
    context_reduced = context_delta < 0
    return BenchmarkComparison(
        baseline_architecture_id=baseline.architecture_id,
        candidate_architecture_id=candidate.architecture_id,
        passed=capability_preserved and quality_preserved and context_reduced,
        historical_capability_coverage_preserved=capability_preserved,
        task_quality_preserved=quality_preserved,
        context_tokens_reduced=context_reduced,
        capability_coverage_delta=capability_delta,
        quality_delta=quality_delta,
        context_tokens_delta=context_delta,
    )


def replay_recorded_observations(
    tasks: Iterable[ReplayTask],
    architecture: BenchmarkArchitecture,
    observations: Iterable[ReplayObservation],
) -> ReplayResult:
    """Aggregate observations captured by an external replay executor."""
    task_list = list(tasks)
    observation_list = list(observations)
    expected_ids = [task.task_id for task in task_list]
    actual_ids = [observation.task_id for observation in observation_list]
    if actual_ids != expected_ids:
        raise ValueError(
            "Recorded observation task IDs must match the task order exactly."
        )
    routed_tasks = [(task, architecture.route(task)) for task in task_list]
    return ReplayResult(
        architecture.architecture_id,
        tuple(observation_list),
        _aggregate(architecture, routed_tasks, observation_list),
    )
