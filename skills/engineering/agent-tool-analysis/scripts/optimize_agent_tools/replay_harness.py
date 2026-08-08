"""Replay/A-B harness for comparing arbitrary tool architectures."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable, Iterable, Mapping

BASELINE_ARCHITECTURE_ID = "pruned_flat_baseline"


def _string_set(values: Iterable[str], field_name: str) -> frozenset[str]:
    if isinstance(values, (str, bytes)):
        raise ValueError(f"{field_name} must contain strings, not a scalar.")
    result = frozenset(values)
    if not all(isinstance(value, str) and value for value in result):
        raise ValueError(f"{field_name} must contain non-empty strings.")
    return result


@dataclass(frozen=True)
class BenchmarkArchitecture:
    """One manifest architecture with arbitrary parent and agent surfaces."""

    architecture_id: str
    parent_tools: frozenset[str]
    agent_tools: Mapping[str, frozenset[str]] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if not self.architecture_id:
            raise ValueError("Architecture IDs must be non-empty.")
        if any(not agent_id for agent_id in self.agent_tools):
            raise ValueError("Agent IDs must be non-empty.")

    @property
    def available_tools(self) -> frozenset[str]:
        return frozenset(self.parent_tools) | frozenset(
            tool for tools in self.agent_tools.values() for tool in tools
        )

    def requested_activation_path(self, task: ReplayTask) -> tuple[str, ...]:
        """Return the task's explicit route for this architecture, if any."""
        return task.activation_paths.get(self.architecture_id, ())


@dataclass(frozen=True)
class ArchitectureManifest:
    """A complete benchmark and arbitrary candidate architecture manifest."""

    baseline_architecture_id: str
    historical_tool_capability_tools: frozenset[str]
    architectures: tuple[BenchmarkArchitecture, ...]

    def __post_init__(self) -> None:
        if self.baseline_architecture_id != BASELINE_ARCHITECTURE_ID:
            raise ValueError(
                "The manifest baseline must be pruned_flat_baseline."
            )
        architecture_ids = [
            architecture.architecture_id for architecture in self.architectures
        ]
        if len(architecture_ids) != len(set(architecture_ids)):
            raise ValueError("Architecture IDs must be unique.")
        if self.baseline_architecture_id not in architecture_ids:
            raise ValueError("The manifest baseline architecture must be present.")
        if not self.historical_tool_capability_tools:
            raise ValueError("Historical tool-capability tools must not be empty.")
        if self.baseline.agent_tools:
            raise ValueError("The manifest baseline must be flat.")

    @property
    def architecture_ids(self) -> tuple[str, ...]:
        return tuple(
            architecture.architecture_id for architecture in self.architectures
        )

    @property
    def baseline(self) -> BenchmarkArchitecture:
        return next(
            architecture
            for architecture in self.architectures
            if architecture.architecture_id == self.baseline_architecture_id
        )


def build_architecture_manifest(raw: Mapping[str, Any]) -> ArchitectureManifest:
    """Parse an architecture manifest without inferring or optimizing routes."""
    raw_architectures = raw.get("architectures")
    if not isinstance(raw_architectures, list):
        raise ValueError("Manifest architectures must be a list.")

    architectures = []
    for raw_architecture in raw_architectures:
        if not isinstance(raw_architecture, dict):
            raise ValueError("Each manifest architecture must be an object.")
        raw_agents = raw_architecture.get("agents", {})
        if not isinstance(raw_agents, dict):
            raise ValueError("Architecture agents must be an object.")
        agents = {
            str(agent_id): _string_set(tools, f"agents.{agent_id}")
            for agent_id, tools in raw_agents.items()
        }
        architectures.append(
            BenchmarkArchitecture(
                architecture_id=str(raw_architecture["architecture_id"]),
                parent_tools=_string_set(
                    raw_architecture.get("parent_tools", []),
                    "parent_tools",
                ),
                agent_tools=agents,
            )
        )

    return ArchitectureManifest(
        baseline_architecture_id=str(raw["baseline_architecture_id"]),
        historical_tool_capability_tools=_string_set(
            raw["historical_tool_capability_tools"],
            "historical_tool_capability_tools",
        ),
        architectures=tuple(architectures),
    )


@dataclass(frozen=True)
class ReplayTask:
    """A replayable task with explicit per-architecture activation paths."""

    task_id: str
    activation_paths: Mapping[str, tuple[str, ...]] = field(default_factory=dict)


@dataclass(frozen=True)
class ReplayObservation:
    """One executor result with an ordered actual agent path and measured costs."""

    task_id: str
    task_success: bool
    observed_replay_capability_covered: bool
    quality_score: float
    agent_activation_path: tuple[str, ...] = ()
    tool_call_failures: int = 0
    routing_failure: bool = False
    missed_agent_activation: bool = False
    unnecessary_agent_activation: bool = False
    total_input_tokens: int = 0
    tool_definition_context_tokens: int = 0
    delegation_tokens: int = 0
    inter_agent_communication_tokens: int = 0
    turns: int = 0
    wall_clock_seconds: float = 0.0


@dataclass(frozen=True)
class ReplayAggregate:
    """Aggregated task, capability, and orchestration measurements."""

    task_count: int
    task_success_rate: float
    historical_tool_capability_coverage_rate: float
    observed_replay_capability_coverage_rate: float
    mean_quality_score: float
    tool_call_failures: int
    routing_failures: int
    missed_agent_activations: int
    unnecessary_agent_activations: int
    total_input_tokens: int
    tool_definition_context_tokens: int
    delegation_tokens: int
    inter_agent_communication_tokens: int
    turns: int
    agent_activations: int
    delegation_count: int
    inter_agent_handoffs: int
    wall_clock_seconds: float

    @property
    def total_tool_context_tokens(self) -> int:
        """Alias matching the benchmark's public metric name."""
        return self.tool_definition_context_tokens

    @property
    def orchestration_tokens(self) -> int:
        """Total explicit delegation and inter-agent communication cost."""
        return self.delegation_tokens + self.inter_agent_communication_tokens

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
    observed_replay_capability_coverage_preserved: bool
    task_quality_preserved: bool
    context_tokens_reduced: bool
    historical_capability_coverage_delta: float
    observed_replay_capability_coverage_delta: float
    quality_delta: float
    context_tokens_delta: int

    @property
    def quality_preserved(self) -> bool:
        return self.task_quality_preserved


ReplayExecutor = Callable[
    [ReplayTask, BenchmarkArchitecture, tuple[str, ...]], ReplayObservation
]


def historical_tool_capability_coverage(
    architecture: BenchmarkArchitecture,
    historical_tools: Iterable[str],
) -> float:
    """Measure manifest tool capability independently of replay outcomes."""
    required = frozenset(historical_tools)
    return (
        len(required & architecture.available_tools) / len(required)
        if required
        else 1.0
    )


def run_replay(
    tasks: Iterable[ReplayTask],
    architecture: BenchmarkArchitecture,
    executor: ReplayExecutor,
    *,
    historical_tools: Iterable[str],
) -> ReplayResult:
    """Replay tasks through explicit manifest paths using an external executor."""
    observations: list[ReplayObservation] = []
    routed_tasks: list[tuple[ReplayTask, tuple[str, ...]]] = []
    for task in tasks:
        activation_path = architecture.requested_activation_path(task)
        routed_tasks.append((task, activation_path))
        observation = executor(task, architecture, activation_path)
        if observation.task_id != task.task_id:
            raise ValueError(
                f"Executor returned {observation.task_id!r} for {task.task_id!r}."
            )
        observations.append(observation)

    aggregate = _aggregate(
        architecture,
        routed_tasks,
        observations,
        historical_tools=frozenset(historical_tools),
    )
    return ReplayResult(architecture.architecture_id, tuple(observations), aggregate)


def _aggregate(
    architecture: BenchmarkArchitecture,
    routed_tasks: list[tuple[ReplayTask, tuple[str, ...]]],
    observations: list[ReplayObservation],
    *,
    historical_tools: frozenset[str],
) -> ReplayAggregate:
    task_count = len(observations)
    actual_paths = [observation.agent_activation_path for observation in observations]
    routing_failures = 0
    missed = 0
    unnecessary = 0
    for (_task, expected_path), observation in zip(
        routed_tasks, observations, strict=True
    ):
        unsupported = set(expected_path) - set(architecture.agent_tools)
        routing_failures += int(observation.routing_failure or bool(unsupported))
        missed += int(
            observation.missed_agent_activation
            or (bool(expected_path) and observation.agent_activation_path != expected_path)
        )
        unnecessary += int(observation.unnecessary_agent_activation)
        unnecessary += sum(
            agent_id not in expected_path
            for agent_id in observation.agent_activation_path
        )

    return ReplayAggregate(
        task_count=task_count,
        task_success_rate=(
            sum(observation.task_success for observation in observations) / task_count
            if task_count
            else 0.0
        ),
        historical_tool_capability_coverage_rate=historical_tool_capability_coverage(
            architecture, historical_tools
        ),
        observed_replay_capability_coverage_rate=(
            sum(
                observation.observed_replay_capability_covered
                for observation in observations
            )
            / task_count
            if task_count
            else 0.0
        ),
        mean_quality_score=(
            sum(observation.quality_score for observation in observations) / task_count
            if task_count
            else 0.0
        ),
        tool_call_failures=sum(
            observation.tool_call_failures for observation in observations
        ),
        routing_failures=routing_failures,
        missed_agent_activations=missed,
        unnecessary_agent_activations=unnecessary,
        total_input_tokens=sum(
            observation.total_input_tokens for observation in observations
        ),
        tool_definition_context_tokens=sum(
            observation.tool_definition_context_tokens
            for observation in observations
        ),
        delegation_tokens=sum(
            observation.delegation_tokens for observation in observations
        ),
        inter_agent_communication_tokens=sum(
            observation.inter_agent_communication_tokens
            for observation in observations
        ),
        turns=sum(observation.turns for observation in observations),
        agent_activations=sum(len(path) for path in actual_paths),
        delegation_count=sum(max(len(path) - 1, 0) for path in actual_paths),
        inter_agent_handoffs=sum(max(len(path) - 1, 0) for path in actual_paths),
        wall_clock_seconds=sum(
            observation.wall_clock_seconds for observation in observations
        ),
    )


def compare_to_benchmark(
    baseline: ReplayResult, candidate: ReplayResult
) -> BenchmarkComparison:
    """Apply the strict historical-coverage, quality, and context gate."""
    historical_delta = (
        candidate.aggregate.historical_tool_capability_coverage_rate
        - baseline.aggregate.historical_tool_capability_coverage_rate
    )
    observed_delta = (
        candidate.aggregate.observed_replay_capability_coverage_rate
        - baseline.aggregate.observed_replay_capability_coverage_rate
    )
    quality_delta = (
        candidate.aggregate.mean_quality_score - baseline.aggregate.mean_quality_score
    )
    context_delta = (
        candidate.aggregate.total_tool_context_tokens
        - baseline.aggregate.total_tool_context_tokens
    )
    historical_preserved = (
        candidate.aggregate.historical_tool_capability_coverage_rate == 1.0
        and historical_delta >= 0
    )
    quality_preserved = quality_delta >= 0
    context_reduced = context_delta < 0
    return BenchmarkComparison(
        baseline_architecture_id=baseline.architecture_id,
        candidate_architecture_id=candidate.architecture_id,
        passed=historical_preserved and quality_preserved and context_reduced,
        historical_capability_coverage_preserved=historical_preserved,
        observed_replay_capability_coverage_preserved=observed_delta >= 0,
        task_quality_preserved=quality_preserved,
        context_tokens_reduced=context_reduced,
        historical_capability_coverage_delta=historical_delta,
        observed_replay_capability_coverage_delta=observed_delta,
        quality_delta=quality_delta,
        context_tokens_delta=context_delta,
    )


def replay_recorded_observations(
    tasks: Iterable[ReplayTask],
    architecture: BenchmarkArchitecture,
    observations: Iterable[ReplayObservation],
    *,
    historical_tools: Iterable[str],
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
    routed_tasks = [
        (task, architecture.requested_activation_path(task)) for task in task_list
    ]
    return ReplayResult(
        architecture.architecture_id,
        tuple(observation_list),
        _aggregate(
            architecture,
            routed_tasks,
            observation_list,
            historical_tools=frozenset(historical_tools),
        ),
    )
