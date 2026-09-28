# Codex Bridge design

## Purpose

Codex Bridge lets an agent running in any coding harness delegate a bounded task
to a locally installed Codex CLI, then collect or continue that work reliably.
It mirrors the useful shape of `agy-staff` without coupling callers to a
particular harness.

The local working name is `codex-bridge`. It will be renamed once the final
repository name is chosen.

## Goals

- Offer a universal command-line interface that works wherever `codex` and
  Node.js 20+ are installed.
- Offer an MCP stdio adapter for harnesses that consume tools rather than
  shell commands.
- Provide focused delegation personas: `ask`, `research`, `review`,
  `implement`, and `staffer`.
- Run work asynchronously where appropriate, preserve enough state to collect,
  diagnose, cancel, and continue it, and avoid unsolicited progress polling.
- Preserve caller control over the workspace, approval, sandbox, and costly or
  irreversible actions.

## Non-goals for v1

- Reimplement the Codex app, app-server protocol, or a general agent runtime.
- Provide a hosted service, browser UI, remote worker pool, or multi-machine
  scheduler.
- Bypass Codex authentication, sandboxing, approval, or policy controls.
- Support every harness natively on day one; direct CLI support is universal
  and adapters are additive.

## Architecture

```text
Harness skill / direct caller
           |
           +--> codex-bridge CLI <-------------------------------+
           |        |                                             |
           |        +--> core launcher --> `codex exec --json`   |
           |                            --> child Codex process  |
           |                                                      |
           +--> MCP stdio server --> same core -------------------+
                                      |
                                      +--> .codex-bridge/ job state
```

The core owns all behavior. Skills and the MCP server are adapters only and
must not implement competing job, state, or permission logic.

`codex exec --json` is the execution boundary. Its event stream supplies the
thread identifier, progress events, final answer, usage data, and terminal
status. A persisted thread identifier enables a supported continuation command.

## Repository layout

```text
packages/
  core/        CLI, process execution, JSONL parsing, state, personas
  mcp/         stdio MCP server that delegates to core
skills/        canonical persona instructions
adapters/      generated or thin harness-specific skill/plugin entrypoints
templates/     shared prompt and safety templates
tests/         fake-Codex fixtures and integration tests
docs/          installation, protocol, and security documentation
```

The implementation uses Node.js 20+ native ES modules and Node's built-in test
runner. Production dependencies are avoided unless an MCP protocol dependency
is necessary and cannot be replaced cleanly by the SDK's supported transport.

## Commands and job lifecycle

The public CLI will expose:

```text
codex-bridge ask       # synchronous, final answer on stdout
codex-bridge run       # starts a background persona task; returns a job ID
codex-bridge wait      # waits for result or a caller-provided soft timeout
codex-bridge status    # bounded metadata and diagnostic tail
codex-bridge result    # full stored report
codex-bridge cancel    # requests and verifies cancellation
codex-bridge continue  # resumes a completed/recoverable job's Codex thread
```

`run` accepts the persona, workspace, task, optional model, and an explicit
execution profile. It returns a stable job ID before the child is complete.
`wait` is the normal collection path. `status` is only for a caller that
explicitly needs progress or a failure diagnosis. A soft wait timeout does not
cancel work.

Each job runs in the original canonical workspace. State files include the
launch configuration, workspace path, process details, captured Codex thread
ID, append-only raw events, final result, lifecycle state, timestamps, and a
bounded diagnostic log.

State is held in `<repo>/.codex-bridge/`; on first use the tool adds this path
to `.git/info/exclude`, never to the tracked `.gitignore`. Writes use
temporary files plus atomic rename, and locking prevents concurrent updates
from corrupting a job.

## Personas and safety

| Persona | Execution | Default profile | Intended use |
| --- | --- | --- | --- |
| `ask` | synchronous | read-only | short question or smoke test |
| `research` | background | read-only | repo/topic investigation |
| `review` | background | read-only | code, plan, or decision review |
| `implement` | background | workspace-write | scoped implementation |
| `staffer` | background | workspace-write | general delegation |

Profiles resolve to explicit Codex sandbox and approval flags. The default
does not enable network access, commit, push, pull-request creation, destructive
cleanup, or sandbox/approval bypass. A caller may authorize an otherwise
restricted operation only by explicitly including it in its delegated task.
Prompts tell the worker to preserve unrelated dirty workspace changes and to
report the actions it actually performed.

## MCP interface

The MCP server uses stdio and exposes:

- `codex_start`
- `codex_wait`
- `codex_status`
- `codex_result`
- `codex_cancel`
- `codex_continue`

Inputs match the CLI's validated values. Tool responses contain job IDs,
terminal states, bounded summaries, and paths only where that helps recovery.
`codex_result` is the only operation that returns a full report.

## Failure handling

- Missing or incompatible `codex` produces a preflight error with a remediation
  command; no job is launched.
- Malformed JSONL, unexpected process exits, or incomplete terminal events
  preserve raw events and diagnostics and mark a job `failed` or `recoverable`.
- A timeout first marks the job as attention-required; it never retries or
  continues automatically.
- Cancellation confirms that the owned process was signaled and records a
  terminal outcome; an uncertain signal outcome remains visible as
  `cancel_pending` rather than falsely claiming success.
- `continue` is permitted only when the persisted thread ID and workspace are
  available. It never guesses a global "last" Codex session.

## Testing and verification

Tests use a fake `codex` executable to cover event parsing, completion, bad
events, timeouts, cancellation, continuation, workspace binding, dirty-tree
context, concurrent state operations, and Windows paths. MCP tests exercise
request validation and prove that its calls use the same core code paths.

An opt-in smoke test checks the locally installed Codex version and performs a
minimal non-mutating `ask` task. It is excluded from the offline test suite.

## Documentation and delivery

The project will ship installation instructions for direct CLI callers and
MCP-capable harnesses, a concise security model, examples for each persona,
and an MIT license. Canonical skills remain the source of truth; harness
adapters are generated or mechanically checked to prevent drift.
