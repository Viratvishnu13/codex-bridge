---
name: jobs
description: Use Codex Bridge task invocation and result collection conventions.
---

`ask` is synchronous. `run` launches a detached worker and returns a stable job ID immediately. Use `wait <job-id>` to collect its final report, `status` for bounded state, `result` for an already-completed report, `cancel` to request cancellation, and `continue --job <job-id> --prompt "…"` to continue a completed Codex thread.
