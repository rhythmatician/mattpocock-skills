# Cross-platform runtime

Initialize the persistent graphify interpreter before any full-build or subcommand runbook. Select exactly one branch for the active shell. After initialization, invoke Python as `graphify_python <arguments>`; never copy the other shell's syntax into the active branch.

## Contents

- [Windows PowerShell](#windows-powershell)
- [Runbook Python payloads](#execute-runbook-python-payloads)
- [POSIX shell](#posix-shell)

## Windows PowerShell

```powershell
$graphifyOut = Join-Path (Get-Location) 'graphify-out'
New-Item -ItemType Directory -Force -Path $graphifyOut | Out-Null
$interpreterFile = Join-Path $graphifyOut '.graphify_python'

if (Test-Path -LiteralPath $interpreterFile) {
    $graphifyPython = (Get-Content -LiteralPath $interpreterFile -Raw).Trim()
}

if (-not $graphifyPython -or -not (Test-Path -LiteralPath $graphifyPython)) {
    $uv = Get-Command uv -ErrorAction SilentlyContinue
    if ($uv) {
        $candidate = (& $uv.Source tool run --from graphifyy python -c 'import sys; print(sys.executable)' 2>$null | Select-Object -Last 1).Trim()
        if ($candidate -and (Test-Path -LiteralPath $candidate)) {
            $graphifyPython = $candidate
        }
    }

    if (-not $graphifyPython) {
        $pythonCommand = Get-Command python -ErrorAction SilentlyContinue
        if (-not $pythonCommand) {
            $pythonCommand = Get-Command py -ErrorAction SilentlyContinue
        }
        if (-not $pythonCommand) {
            throw 'Python is required to install or run graphify.'
        }
        $graphifyPython = $pythonCommand.Source
    }

    & $graphifyPython -c 'import graphify' 2>$null
    if ($LASTEXITCODE -ne 0) {
        if ($uv) {
            & $uv.Source tool install --upgrade graphifyy -q
            $graphifyPython = (& $uv.Source tool run --from graphifyy python -c 'import sys; print(sys.executable)' | Select-Object -Last 1).Trim()
        } else {
            & $graphifyPython -m pip install graphifyy -q
        }
    }

    & $graphifyPython -c "import sys; from pathlib import Path; Path(r'$interpreterFile').write_text(sys.executable, encoding='utf-8')"
}

function graphify_python {
    & $script:graphifyPython @args
}
```

## Execute runbook Python payloads

Every directly linked runbook presents multiline Python as a fenced `python` payload, never as a shell `-c` string. Execute the same payload on PowerShell and POSIX as follows:

1. Substitute runbook placeholders as valid Python literals.
2. Use `apply_patch` (or the host's equivalent file-edit primitive, not shell redirection) to create `graphify-out/.graphify_snippet.py` with the exact payload.
3. Run this identical command in either shell:

```text
graphify_python graphify-out/.graphify_snippet.py
```

4. Delete only `graphify-out/.graphify_snippet.py` after success or failure. Never place untrusted user text into a shell command; encode it as a Python literal in the materialized script.

Persist the resolved scan root without shell substitution:

```powershell
$scanRoot = (Resolve-Path -LiteralPath 'INPUT_PATH').Path
[System.IO.File]::WriteAllText((Join-Path $graphifyOut '.graphify_root'), $scanRoot, [System.Text.UTF8Encoding]::new($false))
```

All referenced runbooks invoke the interpreter through `graphify_python`. For cleanup on Windows, use only explicit targets:

```powershell
$temporaryFiles = @(
    '.graphify_detect.json', '.graphify_extract.json', '.graphify_ast.json',
    '.graphify_semantic.json', '.graphify_analysis.json', '.graphify_cached.json',
    '.graphify_uncached.txt', '.graphify_semantic_new.json', '.graphify_old.json',
    'needs_update', '.graphify_incremental.json', '.graphify_transcripts.json',
    '.vocab.txt', '.graphify_snippet.py'
)
foreach ($name in $temporaryFiles) {
    Remove-Item -LiteralPath (Join-Path $graphifyOut $name) -Force -ErrorAction SilentlyContinue
}
Get-ChildItem -LiteralPath $graphifyOut -File -Filter '.graphify_chunk_*.json' |
    Remove-Item -Force -ErrorAction SilentlyContinue
```

## POSIX shell

```bash
mkdir -p graphify-out
GRAPHIFY_PYTHON="$(cat graphify-out/.graphify_python 2>/dev/null || true)"
if [ -z "$GRAPHIFY_PYTHON" ]; then
    if command -v uv >/dev/null 2>&1; then
        uv tool install --upgrade graphifyy -q
        GRAPHIFY_PYTHON="$(uv tool run --from graphifyy python -c 'import sys; print(sys.executable)')"
    else
        GRAPHIFY_PYTHON="$(command -v python3 || command -v python)"
        "$GRAPHIFY_PYTHON" -c 'import graphify' 2>/dev/null || "$GRAPHIFY_PYTHON" -m pip install graphifyy -q
    fi
    "$GRAPHIFY_PYTHON" -c "import sys; from pathlib import Path; Path('graphify-out/.graphify_python').write_text(sys.executable, encoding='utf-8')"
fi
graphify_python() { "$GRAPHIFY_PYTHON" "$@"; }
```

For cleanup on POSIX, remove the same explicit temporary files as the PowerShell branch and only matching chunk files:

```bash
for graphify_temp in \
    graphify-out/.graphify_detect.json \
    graphify-out/.graphify_extract.json \
    graphify-out/.graphify_ast.json \
    graphify-out/.graphify_semantic.json \
    graphify-out/.graphify_analysis.json \
    graphify-out/.graphify_cached.json \
    graphify-out/.graphify_uncached.txt \
    graphify-out/.graphify_semantic_new.json \
    graphify-out/.graphify_old.json \
    graphify-out/needs_update \
    graphify-out/.graphify_incremental.json \
    graphify-out/.graphify_transcripts.json \
    graphify-out/.vocab.txt \
    graphify-out/.graphify_snippet.py
do
    if [ -f "$graphify_temp" ]; then
        rm -- "$graphify_temp"
    fi
done

for graphify_chunk in graphify-out/.graphify_chunk_*.json
do
    if [ -f "$graphify_chunk" ]; then
        rm -- "$graphify_chunk"
    fi
done
```

The POSIX constructs in this branch apply only to POSIX shells.
