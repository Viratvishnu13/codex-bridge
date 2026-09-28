# Codex Bridge

Codex Bridge lets any harness that can run a command or speak MCP send a bounded task to a locally installed Codex CLI.

## CLI

```powershell
node bin/codex-bridge.mjs ask --prompt "Summarize the repository's tests"
```

The task runs through `codex exec --json` with a read-only sandbox. Its local metadata remains in `.codex-bridge/`, which is added to the repository's local Git exclude file.

## MCP

Start the stdio MCP server:

```powershell
node bin/codex-bridge-mcp.mjs
```

It exposes `codex_ask(prompt, workspace?, model?)`. MCP-capable callers receive the final Codex report as text.

## Personas

`ask` is a short read-only call. The general command accepts `research`, `review`, `implement`, and `staffer`:

```powershell
node bin/codex-bridge.mjs run --persona review --prompt "Review the current working tree"
```

## Requirements

- Node.js 20+
- A logged-in local `codex` CLI

## Safety

The shipped `ask` path is read-only and does not bypass Codex approvals. Prompts are not a security boundary; use an isolated checkout for untrusted repositories.
