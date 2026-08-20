#!/usr/bin/env bash
set -euo pipefail

# NOTE: This is a dev-only script, intended for use by maintainers of this repo.
# It is not a supported installer. Modifications to it, or requests for
# modifications, will not be approved.
#
# Links all skills in the repository into the local skill directories used by
# each agent harness:
#   - ~/.claude/skills: Claude Code
#   - ~/.agents/skills: Codex and other Agent Skills-compatible harnesses
#   - ~/.copilot/skills: VS Code Copilot (GitHub Copilot)
# Each entry is a symlink into this repo, so a `git pull` is all that's needed
# to keep installed skills up to date.

REPO="$(cd "$(dirname "$0")/.." && pwd)"

# Detect Windows user profile path for VS Code Copilot
# In WSL, $HOME is /home/user but Windows apps use /mnt/c/Users/user
if [[ -n "${WSL_DISTRO_NAME:-}" ]] || [[ -f /proc/version && $(cat /proc/version) == *microsoft* ]]; then
  # Running in WSL - use Windows path for Copilot
  WIN_USER="${USERNAME:-$(cmd.exe /c 'echo %USERNAME%' 2>/dev/null | tr -d '\r')}"
  COPILOT_SKILLS="/mnt/c/Users/$WIN_USER/.copilot/skills"
else
  # Native Linux/macOS
  COPILOT_SKILLS="$HOME/.copilot/skills"
fi

DESTS=("$HOME/.claude/skills" "$HOME/.agents/skills" "$COPILOT_SKILLS")

# Collect the repo's skills once, link into every destination.
names=()
srcs=()
while IFS= read -r -d '' skill_md; do
  src="$(dirname "$skill_md")"
  names+=("$(basename "$src")")
  srcs+=("$src")
done < <(find "$REPO/skills" -name SKILL.md -not -path '*/node_modules/*' -not -path '*/deprecated/*' -print0)

# Convert a WSL path (/mnt/c/Users/...) to a Windows path (C:\Users\...).
# Only meaningful when running under WSL; returns the path unchanged otherwise.
wsl_to_win_path() {
  local p="$1"
  if [[ "$p" =~ ^/mnt/([a-zA-Z])/(.*)$ ]]; then
    local drive="${BASH_REMATCH[1]^^}"
    local rest="${BASH_REMATCH[2]}"
    # Convert forward slashes to backslashes
    rest="${rest//\//\\}"
    echo "${drive}:\\${rest}"
  else
    echo "$p"
  fi
}

for DEST in "${DESTS[@]}"; do
  # If $DEST is a symlink that resolves into this repo, we'd end up writing the
  # per-skill symlinks back into the repo's own skills/ tree. Detect and bail
  # out instead of polluting the working copy.
  if [ -L "$DEST" ]; then
    resolved="$(readlink -f "$DEST")"
    case "$resolved" in
      "$REPO"|"$REPO"/*)
        echo "error: $DEST is a symlink into this repo ($resolved)." >&2
        echo "Remove it (rm \"$DEST\") and re-run; the script will recreate it as a real dir." >&2
        exit 1
        ;;
    esac
  fi

  mkdir -p "$DEST"

  # When the destination is on a Windows filesystem (e.g. /mnt/c/...), use
  # Windows junction points (mklink /J) instead of WSL symlinks. WSL symlinks
  # on /mnt/c/ create Linux reparse points that Windows apps (like VS Code)
  # cannot resolve. Junction points are visible to both WSL and Windows.
  local_win=0
  if [[ "$DEST" == /mnt/* ]]; then
    local_win=1
  fi

  for i in "${!names[@]}"; do
    name="${names[$i]}"
    src="${srcs[$i]}"
    target="$DEST/$name"

    if [ "$local_win" -eq 1 ]; then
      # Remove existing entry (WSL reparse point, junction, or real dir)
      if [ -e "$target" ] || [ -L "$target" ]; then
        rm -rf "$target" 2>/dev/null || true
      fi
      win_target="$(wsl_to_win_path "$target")"
      win_src="$(wsl_to_win_path "$src")"
      powershell.exe -NoProfile -Command "New-Item -ItemType Junction -Path '$win_target' -Target '$win_src'" > /dev/null
      echo "linked $name -> $src ($DEST) [junction]"
    else
      if [ -e "$target" ] && [ ! -L "$target" ]; then
        rm -rf "$target"
      fi
      ln -sfn "$src" "$target"
      echo "linked $name -> $src ($DEST)"
    fi
  done
done
