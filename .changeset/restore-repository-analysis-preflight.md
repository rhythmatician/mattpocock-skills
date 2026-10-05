---
"mattpocock-skills": patch
---

Restore the repository-analysis Node wrapper omitted from PR #27. The wrapper checks `os.userInfo()` before loading `tsx`, reports the operating-system failure directly, and preserves the child runner's exit code. Package-script dependency coverage and Windows and Ubuntu CI now catch missing helpers.
