# graphify reference: GitHub clone and cross-repo merge

Load this when the user passed one or more `https://github.com/...` URLs, or named several local subfolders to merge into one graph.

### Step 0 - Clone GitHub repo(s) (only if a GitHub URL was given)

**Single repo:**
```powershell
$localPath = (graphify_python -m graphify clone <github-url> [--branch <branch>] | Select-Object -Last 1).Trim()
```

```bash
LOCAL_PATH="$(graphify_python -m graphify clone <github-url> [--branch <branch>] | tail -n 1)"
```

Execute only the active shell's branch and use the resolved path for every later step.

**Multiple repos (cross-repo graph):**
```text
# Clone each repo, run the full pipeline on each, then merge
graphify_python -m graphify clone <url1>   # → ~/.graphify/repos/<owner1>/<repo1>
graphify_python -m graphify clone <url2>   # → ~/.graphify/repos/<owner2>/<repo2>
# Run /graphify on each local path to produce their graph.json files
# Then merge:
graphify_python -m graphify merge-graphs ~/.graphify/repos/<owner1>/<repo1>/graphify-out/graph.json ~/.graphify/repos/<owner2>/<repo2>/graphify-out/graph.json --out graphify-out/cross-repo-graph.json
```

graphify_python -m graphify clones into `~/.graphify/repos/<owner>/<repo>` and reuses existing clones on repeat runs. Each node in the merged graph carries a `repo` attribute so you can filter by origin.

**Multiple local subfolders (monorepo or multi-service layout):**

The skill pipeline writes all intermediate and final outputs to `graphify-out/` in the current working directory. Running the skill on each subfolder separately will clobber the same output dir. Instead, use the CLI directly for each subfolder — it places `graphify-out/` *inside* the scanned path:

```text
graphify_python -m graphify extract ./core/     # → ./core/graphify-out/graph.json
graphify_python -m graphify extract ./service/  # → ./service/graphify-out/graph.json
graphify_python -m graphify extract ./platform/ # → ./platform/graphify-out/graph.json
# Add --backend gemini|kimi|openai|deepseek|claude-cli depending on which API key you have set

# Then merge at the project root:
graphify_python -m graphify merge-graphs ./core/graphify-out/graph.json ./service/graphify-out/graph.json ./platform/graphify-out/graph.json --out graphify-out/graph.json
```

Once `graphify-out/graph.json` exists, the fast path above takes over: any codebase question runs `graphify_python -m graphify query` directly on the merged graph — no re-extraction, no size gate.
