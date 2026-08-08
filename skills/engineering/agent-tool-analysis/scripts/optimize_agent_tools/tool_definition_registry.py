"""Runtime-independent tool-definition acquisition primitives.

Providers return definitions with explicit provenance.  The registry applies the
stable precedence contract: explicit user input, direct telemetry, runtime
manifests/introspection, then unresolved.
"""

from __future__ import annotations

import json
from abc import ABC, abstractmethod
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Iterable

DEFINITION_KEYS = {
    "description",
    "input_schema",
    "inputSchema",
    "parameters",
    "schema",
    "args_schema",
    "arguments_schema",
}

_MANIFEST_NAME_PARTS = (
    "manifest",
    "tool",
    "mcp",
    "plugin",
    "provider",
    "config",
)
_IGNORED_PATH_PARTS = {"sessions", "logs", "history", "cache"}


@dataclass(frozen=True)
class DefinitionRecord:
    normalized_name: str
    runtime: str
    provider: str
    raw_name: str
    description: str | None
    input_schema: Any
    serialized_chars: int | None
    estimated_tokens: int | None
    source: str
    confidence: str
    evidence_type: str


class ToolDefinitionProvider(ABC):
    """Source of advertised tool definitions, independent of any runtime."""

    precedence: int = 0

    @abstractmethod
    def records(self) -> Iterable[DefinitionRecord]:
        """Return the definitions discovered by this provider."""

    def resolve(
        self, normalized_name: str, runtime: str | None = None
    ) -> DefinitionRecord | None:
        for record in self.records():
            if record.normalized_name == normalized_name and (
                runtime is None or record.runtime == runtime
            ):
                return record
        return None


class MappingDefinitionProvider(ToolDefinitionProvider):
    """Provider for already-extracted definitions, such as telemetry."""

    def __init__(
        self,
        definitions: Iterable[DefinitionRecord],
        *,
        precedence: int,
    ) -> None:
        self.precedence = precedence
        self._records = tuple(definitions)

    def records(self) -> Iterable[DefinitionRecord]:
        return self._records


class ExplicitDefinitionProvider(MappingDefinitionProvider):
    """Provider for explicit cost or definition overrides supplied by a user."""

    def __init__(
        self,
        records: Iterable[DefinitionRecord],
    ) -> None:
        super().__init__(records, precedence=300)

    @classmethod
    def from_path(
        cls,
        path: str | None,
        normalize: Callable[[str | None], str | None],
    ) -> "ExplicitDefinitionProvider":
        if not path:
            return cls(())

        with open(path, "r", encoding="utf-8") as stream:
            data = json.load(stream)
        if not isinstance(data, dict):
            raise ValueError("--tool-costs must contain a JSON object.")

        records: list[DefinitionRecord] = []
        for raw_name, raw_value in data.items():
            name = normalize(raw_name)
            if not name:
                continue

            if isinstance(raw_value, int):
                if raw_value < 0:
                    raise ValueError(f"Token cost for {raw_name!r} cannot be negative.")
                records.append(
                    DefinitionRecord(
                        normalized_name=name,
                        runtime="any",
                        provider="explicit",
                        raw_name=raw_name,
                        description=None,
                        input_schema=None,
                        serialized_chars=None,
                        estimated_tokens=raw_value,
                        source=f"explicit:{Path(path).resolve()}",
                        confidence="explicit",
                        evidence_type="user_supplied_cost",
                    )
                )
                continue

            if not isinstance(raw_value, dict):
                raise ValueError(
                    f"Invalid definition for {raw_name!r}; expected integer or object."
                )

            tokens = raw_value.get("tokens")
            if tokens is not None and (not isinstance(tokens, int) or tokens < 0):
                raise ValueError(f"Invalid token cost for {raw_name!r}.")

            description = raw_value.get("description")
            input_schema = raw_value.get("inputSchema", raw_value.get("input_schema"))
            if input_schema is None:
                input_schema = raw_value.get("parameters", raw_value.get("schema"))
            subset = {"name": raw_name}
            if description is not None:
                subset["description"] = description
            if input_schema is not None:
                subset["inputSchema"] = input_schema
            serialized_chars = (
                canonical_json_length(subset) if len(subset) > 1 else None
            )
            estimated_tokens = tokens
            if estimated_tokens is None and serialized_chars is not None:
                estimated_tokens = estimate_tokens_from_chars(serialized_chars)
            if estimated_tokens is None:
                raise ValueError(
                    f"Definition for {raw_name!r} needs tokens, description, or input schema."
                )

            records.append(
                DefinitionRecord(
                    normalized_name=name,
                    runtime=str(raw_value.get("runtime", "any")),
                    provider="explicit",
                    raw_name=raw_name,
                    description=description if isinstance(description, str) else None,
                    input_schema=input_schema,
                    serialized_chars=serialized_chars,
                    estimated_tokens=estimated_tokens,
                    source=f"explicit:{Path(path).resolve()}",
                    confidence="explicit",
                    evidence_type="user_supplied_definition",
                )
            )

        return cls(records)


class ManifestDefinitionProvider(ToolDefinitionProvider):
    """Discover definitions from explicit local runtime/provider artifact roots."""

    def __init__(
        self,
        roots: Iterable[str],
        normalize: Callable[[str | None], str | None],
        *,
        runtime: str = "codex",
    ) -> None:
        self.precedence = 100
        self._roots = tuple(Path(root).expanduser() for root in roots if root)
        self._normalize = normalize
        self._runtime = runtime
        self._loaded = False
        self._records: dict[str, DefinitionRecord] = {}
        self.files_scanned = 0
        self.files_with_definitions = 0

    def records(self) -> Iterable[DefinitionRecord]:
        self._load()
        return tuple(self._records.values())

    def discovery_summary(self) -> dict[str, Any]:
        self._load()
        return {
            "runtime": self._runtime,
            "roots": [str(root) for root in self._roots],
            "files_scanned": self.files_scanned,
            "files_with_definitions": self.files_with_definitions,
            "definitions_found": len(self._records),
            "definitions": [
                {
                    "normalized_name": record.normalized_name,
                    "source": record.source,
                    "provider": record.provider,
                    "confidence": record.confidence,
                    "evidence_type": record.evidence_type,
                    "estimated_tokens": record.estimated_tokens,
                }
                for record in sorted(
                    self._records.values(), key=lambda item: item.normalized_name
                )
            ],
        }

    def _load(self) -> None:
        if self._loaded:
            return
        self._loaded = True

        for root in self._roots:
            if not root.is_dir():
                continue
            for file_path in root.rglob("*"):
                if not file_path.is_file() or not self._is_candidate(file_path):
                    continue
                self.files_scanned += 1
                before = len(self._records)
                self._read_file(file_path)
                if len(self._records) > before:
                    self.files_with_definitions += 1

    def _is_candidate(self, file_path: Path) -> bool:
        if file_path.suffix.lower() not in {".json", ".jsonl"}:
            return False
        parts = {part.lower() for part in file_path.parts}
        if parts & _IGNORED_PATH_PARTS:
            return False
        stem = file_path.stem.lower()
        return any(part in stem for part in _MANIFEST_NAME_PARTS)

    def _read_file(self, file_path: Path) -> None:
        try:
            if file_path.stat().st_size > 4 * 1024 * 1024:
                return
            if file_path.suffix.lower() == ".jsonl":
                with file_path.open("r", encoding="utf-8", errors="ignore") as stream:
                    for line in stream:
                        if not line.strip():
                            continue
                        try:
                            value = json.loads(line)
                        except json.JSONDecodeError:
                            continue
                        self._inspect_value(value, file_path)
            else:
                with file_path.open("r", encoding="utf-8", errors="ignore") as stream:
                    self._inspect_value(json.load(stream), file_path)
        except (OSError, json.JSONDecodeError, UnicodeError):
            return

    def _inspect_value(self, value: Any, file_path: Path) -> None:
        for node in walk_json(value):
            if not isinstance(node, dict):
                continue
            raw_name = node.get("name")
            if not isinstance(raw_name, str):
                continue
            schema_key = next((key for key in DEFINITION_KEYS if key in node), None)
            if schema_key is None:
                continue
            normalized_name = self._normalize(raw_name)
            if not normalized_name:
                continue

            subset = {"name": raw_name}
            for key in DEFINITION_KEYS:
                if key in node:
                    subset[key] = node[key]
            chars = canonical_json_length(subset)
            record = DefinitionRecord(
                normalized_name=normalized_name,
                runtime=self._runtime,
                provider="runtime_manifest",
                raw_name=raw_name,
                description=(
                    node.get("description")
                    if isinstance(node.get("description"), str)
                    else None
                ),
                input_schema=node.get("inputSchema", node.get("input_schema")),
                serialized_chars=chars,
                estimated_tokens=estimate_tokens_from_chars(chars),
                source=str(file_path.resolve()),
                confidence="direct_manifest",
                evidence_type="advertised_definition",
            )
            existing = self._records.get(normalized_name)
            if existing is None or (
                record.serialized_chars is not None
                and (
                    existing.serialized_chars is None
                    or record.serialized_chars > existing.serialized_chars
                )
            ):
                self._records[normalized_name] = record


def legacy_record(definition: Any, *, runtime: str) -> DefinitionRecord:
    """Adapt the optimizer's historical `ToolDefinition` shape to this model."""
    source = str(getattr(definition, "source", "telemetry"))
    source_label = f"telemetry:{runtime}"
    if source not in {runtime, "telemetry"}:
        source_label = f"{source_label}:{source}"
    return DefinitionRecord(
        normalized_name=str(getattr(definition, "name")),
        runtime=runtime,
        provider="telemetry",
        raw_name=str(getattr(definition, "name")),
        description=getattr(definition, "description", None),
        input_schema=getattr(definition, "input_schema", None),
        serialized_chars=getattr(definition, "serialized_chars", None),
        estimated_tokens=getattr(definition, "estimated_tokens", None),
        source=source_label,
        confidence="direct_telemetry",
        evidence_type="recovered_definition",
    )


def estimate_tokens_from_chars(char_count: int) -> int:
    return max(1, (char_count + 3) // 4)


def canonical_json_length(value: Any) -> int:
    try:
        text = json.dumps(
            value, sort_keys=True, separators=(",", ":"), ensure_ascii=False
        )
    except (TypeError, ValueError):
        text = repr(value)
    return len(text)


def walk_json(value: Any) -> Iterable[Any]:
    yield value
    if isinstance(value, dict):
        for child in value.values():
            yield from walk_json(child)
    elif isinstance(value, list):
        for child in value:
            yield from walk_json(child)


class DefinitionRegistry:
    """Resolve names using provider precedence while retaining provenance."""

    def __init__(self, providers: Iterable[ToolDefinitionProvider]) -> None:
        self.providers = tuple(providers)

    def resolve(
        self, normalized_name: str, runtime: str | None = None
    ) -> DefinitionRecord | None:
        candidates = []
        for provider_index, provider in enumerate(self.providers):
            for record in provider.records():
                if record.normalized_name != normalized_name:
                    continue
                if runtime is not None and record.runtime not in {runtime, "any"}:
                    continue
                candidates.append((provider.precedence, provider_index, record))
        if not candidates:
            return None
        return max(candidates, key=lambda item: (item[0], -item[1]))[2]

    def resolve_all(
        self,
        names: Iterable[str],
        runtime: str | None = None,
    ) -> dict[str, DefinitionRecord]:
        return {
            name: record
            for name in sorted(set(names))
            if (record := self.resolve(name, runtime)) is not None
        }
