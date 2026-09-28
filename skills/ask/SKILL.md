---
name: ask
description: Delegate a bounded read-only question to the locally installed Codex CLI.
---

Run `codex-bridge ask --prompt "<task>"` from the target repository. The command returns Codex's final report on stdout and preserves state under the target repository's ignored `.codex-bridge/` folder.

Use this for focused tasks. Do not request commits, pushes, pull requests, destructive cleanup, or network work unless the user explicitly asks for that action.
