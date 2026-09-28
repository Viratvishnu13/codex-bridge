---
name: jobs
description: Use Codex Bridge task invocation and result collection conventions.
---

`ask` is synchronous. `run` currently returns a final report synchronously; it preserves state in `.codex-bridge/` for later inspection. Treat its job ID as diagnostic metadata, not as a promise of durable detached execution until the background-worker commands are installed.
