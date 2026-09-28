# Codex Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local, cross-harness bridge that launches and manages bounded Codex CLI work through a universal CLI and an MCP stdio server.

**Architecture:** The core owns command parsing, workspace discovery, safety profiles, `codex exec --json` process handling, and durable job state. The MCP server, skills, and plugin are thin adapters over that single core.

**Tech Stack:** Node.js 20+ native ESM, Node built-in test runner, `@modelcontextprotocol/sdk` 1.30.1, JSON files, stdio MCP.

**Spec:** `docs/superpowers/specs/2026-09-28-codex-bridge-design.md`

## Global Constraints

- Require Node.js 20 or newer and native ES modules.
- Keep production dependencies to `@modelcontextprotocol/sdk` 1.30.1 only.
- Execute tasks only through `codex exec --json`; never read undocumented Codex session files.
- Store local state in `.codex-bridge/`, add it to `.git/info/exclude`, and never alter tracked `.gitignore`.
- Atomically write every job metadata or result file.
- Default `ask`, `research`, and `review` to read-only; default `staffer` and `implement` to workspace-write.
- Do not enable network, Git delivery, destructive cleanup, or approval/sandbox bypass unless task text explicitly authorizes it.
- Receive task text from exactly one source and never re-tokenize it.
- Default tests use a fake `codex`; real Codex is an opt-in, non-mutating smoke test.
- Support Windows paths and process spawning.

---

## Planned file structure

~~~text
package.json                       package metadata, scripts, bin names, dependency lock
bin/codex-bridge.mjs               CLI argument dispatch and output
bin/codex-bridge-mcp.mjs           MCP stdio executable
src/core/errors.mjs                typed failures and deterministic exit codes
src/core/workspace.mjs             root discovery and local-state setup
src/core/state.mjs                 IDs, atomic writes, validated state transitions
src/core/personas.mjs              persona defaults and worker prompt construction
src/core/args.mjs                  option parsing and task-source validation
src/core/codex-process.mjs         preflight, process spawn, JSONL parsing, termination
src/core/jobs.mjs                  start/wait/status/result/cancel/continue operations
src/mcp/server.mjs                 MCP tools, each delegating to src/core/jobs.mjs
skills/<persona>/SKILL.md          canonical harness-neutral usage instructions
.codex-plugin/plugin.json          exposes canonical skills to Codex
tests/helpers/fake-codex.mjs       deterministic fake executable
tests/*.test.mjs                   offline unit/integration tests
docs/INSTALL.md                    CLI and MCP quickstart
docs/SECURITY.md                   profiles and trust-boundary description
~~~

### Task 1: Bootstrap the Node package and fake-Codex harness

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `bin/codex-bridge.mjs`
- Create: `tests/helpers/fake-codex.mjs`
- Create: `tests/bootstrap.test.mjs`

**Interfaces:**
- Produces `npm test`, `npm run test:smoke`, and executable bin `codex-bridge`.
- `createFakeCodex(t, scenario)` returns a temporary executable that supports `--version` and a selected JSONL scenario.

- [ ] **Step 1: Write the failing bootstrap test**

~~~js
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

test('CLI reports its version without launching Codex', async () => {
  const { stdout } = await promisify(execFile)(
    process.execPath, ['bin/codex-bridge.mjs', '--version']);
  assert.equal(stdout, 'codex-bridge 0.1.0\n');
});
~~~

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/bootstrap.test.mjs`

Expected: FAIL because the bin file does not exist.

- [ ] **Step 3: Add the minimal package, CLI, and fixture**

~~~json
{
  "name": "codex-bridge",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=20" },
  "bin": {
    "codex-bridge": "./bin/codex-bridge.mjs",
    "codex-bridge-mcp": "./bin/codex-bridge-mcp.mjs"
  },
  "scripts": {
    "test": "node --test tests/*.test.mjs",
    "test:smoke": "CODEX_BRIDGE_SMOKE=1 node --test tests/smoke.test.mjs"
  },
  "dependencies": { "@modelcontextprotocol/sdk": "1.30.1" }
}
~~~

~~~js
#!/usr/bin/env node
if (process.argv.includes('--version')) {
  process.stdout.write('codex-bridge 0.1.0\n');
} else {
  process.stderr.write('codex-bridge: command required\n');
  process.exitCode = 64;
}
~~~

Implement the fake fixture with a temporary `.mjs` file and test cleanup registered through `t.after`. Scenarios must include `complete`, `truncated`, `malformed`, `failure`, and `hang`.

- [ ] **Step 4: Run the offline test suite**

Run: `npm test`

Expected: PASS without network access or a real Codex invocation.

- [ ] **Step 5: Commit**

~~~bash
git add package.json package-lock.json .gitignore bin/codex-bridge.mjs tests
git commit -m "chore: bootstrap Codex Bridge package"
~~~

### Task 2: Create workspace and atomic state boundaries

**Files:**
- Create: `src/core/errors.mjs`
- Create: `src/core/workspace.mjs`
- Create: `src/core/state.mjs`
- Create: `tests/workspace.test.mjs`
- Create: `tests/state.test.mjs`

**Interfaces:**
- Produces `BridgeError`, `findWorkspace(path)`, `ensureStateDirectory(workspace)`, `createJob(state, spec)`, `readJob(state, id)`, `transitionJob(state, id, patch)`, and `writeResult(state, id, text)`.
- Job data is `{ id, version: 1, status, workspace, persona, profile, taskSource, startedAt, updatedAt, threadId, pid, exitCode, error }`.

- [ ] **Step 1: Write failing workspace/state tests**

~~~js
test('uses a git root and ignores local bridge state without touching .gitignore', async t => {
  const root = await makeGitRepository(t);
  const nested = path.join(root, 'nested', 'dir');
  await fs.mkdir(nested, { recursive: true });
  assert.equal(await findWorkspace(nested), root);
  await ensureStateDirectory(root);
  const exclude = await fs.readFile(path.join(root, '.git', 'info', 'exclude'), 'utf8');
  assert.match(exclude, /\.codex-bridge\//);
  await assert.rejects(fs.readFile(path.join(root, '.gitignore')), { code: 'ENOENT' });
});

test('publishes only complete atomic job metadata', async t => {
  const state = await makeStateDirectory(t);
  const job = await createJob(state, baseJobSpec(state));
  const running = await transitionJob(state, job.id, { status: 'running', pid: 1234 });
  assert.equal((await readJob(state, running.id)).status, 'running');
});
~~~

- [ ] **Step 2: Run the tests to verify failure**

Run: `node --test tests/workspace.test.mjs tests/state.test.mjs`

Expected: FAIL because the core modules do not exist.

- [ ] **Step 3: Implement the boundary**

~~~js
export async function writeAtomic(file, text) {
  const temporary = file + '.' + process.pid + '.' + randomUUID() + '.tmp';
  await writeFile(temporary, text, 'utf8');
  await rename(temporary, file);
}

export async function transitionJob(state, id, patch) {
  const current = await readJob(state, id);
  const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
  await writeAtomic(jobPath(state, id), JSON.stringify(next, null, 2) + '\n');
  return next;
}
~~~

Walk upward until `.git` is found; otherwise use the resolved start path as workspace. Create `.codex-bridge/jobs` and update `.git/info/exclude` idempotently. Reject job IDs that are not UUIDs, incomplete job specs, and terminal-to-running transitions with `BridgeError`.

- [ ] **Step 4: Run full tests**

Run: `npm test`

Expected: PASS, including an assertion that no temporary write file remains after success.

- [ ] **Step 5: Commit**

~~~bash
git add src/core/errors.mjs src/core/workspace.mjs src/core/state.mjs tests/workspace.test.mjs tests/state.test.mjs
git commit -m "feat: add durable workspace job state"
~~~

### Task 3: Add personas, safe options, and opaque task parsing

**Files:**
- Create: `src/core/personas.mjs`
- Create: `src/core/args.mjs`
- Create: `tests/personas.test.mjs`
- Create: `tests/args.test.mjs`

**Interfaces:**
- Produces `PERSONAS`, `resolveRunOptions(input)`, `buildWorkerPrompt(run)`, and `parseCommand(argv, stdin)`.
- `resolveRunOptions` returns `{ persona, profile, sandbox, approvalPolicy, task, taskSource, model, workspace }`.

- [ ] **Step 1: Write failing policy/parser tests**

~~~js
test('review defaults to a read-only Codex profile', () => {
  const run = resolveRunOptions({ persona: 'review', task: 'Review the diff' });
  assert.equal(run.profile, 'read-only');
  assert.equal(run.sandbox, 'read-only');
  assert.equal(run.approvalPolicy, 'never');
});

test('task text is opaque even when it begins with a flag', () => {
  const parsed = parseCommand(
    ['run', '--persona', 'research', '--prompt', '--json means what?'], '');
  assert.equal(parsed.task, '--json means what?');
});

test('multiple task sources are rejected', () => {
  assert.throws(
    () => parseCommand(['run', '--prompt', 'a', '--stdin'], 'b'),
    /exactly one task source/);
});
~~~

- [ ] **Step 2: Run the tests to verify failure**

Run: `node --test tests/personas.test.mjs tests/args.test.mjs`

Expected: FAIL because persona/parser modules do not exist.

- [ ] **Step 3: Implement profiles and prompt construction**

~~~js
export const PERSONAS = Object.freeze({
  ask: { execution: 'foreground', profile: 'read-only' },
  research: { execution: 'background', profile: 'read-only' },
  review: { execution: 'background', profile: 'read-only' },
  implement: { execution: 'background', profile: 'workspace-write' },
  staffer: { execution: 'background', profile: 'workspace-write' }
});

const PROFILES = Object.freeze({
  'read-only': { sandbox: 'read-only', approvalPolicy: 'never' },
  'workspace-write': { sandbox: 'workspace-write', approvalPolicy: 'never' }
});
~~~

Accept exactly one of `--prompt`, `--prompt-file`, and `--stdin`; preserve file/stdin content byte-for-byte as UTF-8; reject unknown options or blank task text. `buildWorkerPrompt` wraps the unmodified task in `<delegated-task>` tags and appends preservation/no-side-effect guardrails without claiming those prompt guardrails are a security boundary.

- [ ] **Step 4: Run tests**

Run: `npm test`

Expected: PASS with quoted, multiline, and flag-shaped task fixtures.

- [ ] **Step 5: Commit**

~~~bash
git add src/core/personas.mjs src/core/args.mjs tests/personas.test.mjs tests/args.test.mjs
git commit -m "feat: define personas and safe task parsing"
~~~

### Task 4: Launch Codex and capture JSONL events

**Files:**
- Create: `src/core/codex-process.mjs`
- Modify: `tests/helpers/fake-codex.mjs`
- Create: `tests/codex-process.test.mjs`

**Interfaces:**
- Produces `preflightCodex(command)`, `startCodex(run, handlers)`, and `terminateCodex(worker)`.
- `startCodex` returns `{ child, completion, cancel }`; `completion` resolves `{ threadId, finalText, usage, exitCode, eventsPath }`.

- [ ] **Step 1: Write failing process tests**

~~~js
test('passes task text as one argv item and captures final JSONL message', async t => {
  const codex = await createFakeCodex(t, 'complete');
  const worker = await startCodex({ ...baseRun(t), codexCommand: codex, task: 'quote " --model x' });
  const result = await worker.completion;
  assert.equal(result.threadId, 'thread-test-1');
  assert.equal(result.finalText, 'finished safely');
  assert.deepEqual(await capturedArgs(t), [
    'exec', '--json', '--sandbox', 'read-only', '--ask-for-approval', 'never',
    'quote " --model x'
  ]);
});

test('fails when JSONL ends without a final agent message', async t => {
  await assert.rejects(collectScenario(t, 'truncated'), /final agent message/);
});
~~~

- [ ] **Step 2: Run the test to verify failure**

Run: `node --test tests/codex-process.test.mjs`

Expected: FAIL because the process module does not exist.

- [ ] **Step 3: Implement preflight, spawn, parsing, and termination**

~~~js
const args = ['exec', '--json', '--sandbox', run.sandbox,
  '--ask-for-approval', run.approvalPolicy];
if (run.model) args.push('--model', run.model);
args.push(run.task);
const child = spawn(run.codexCommand ?? 'codex', args, {
  cwd: run.workspace, shell: false, windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe']
});
~~~

Run preflight as `<command> --version` without a shell. Append stdout JSONL lines unchanged to the job event file, parse only complete JSON records, type-guard the thread, message, and completion events, and retain a bounded stderr tail. Treat malformed records, nonzero exits, and missing final message as typed failures. Cancellation must signal only the owned child handle, wait a bounded grace period, then report `cancel_pending` if termination cannot be proven.

- [ ] **Step 4: Run tests**

Run: `npm test`

Expected: PASS for preflight error, malformed JSONL, failed worker, quoted input, and cancellation.

- [ ] **Step 5: Commit**

~~~bash
git add src/core/codex-process.mjs tests/helpers/fake-codex.mjs tests/codex-process.test.mjs
git commit -m "feat: run Codex and collect JSONL results"
~~~

### Task 5: Orchestrate jobs and implement the complete CLI lifecycle

**Files:**
- Create: `src/core/jobs.mjs`
- Modify: `bin/codex-bridge.mjs`
- Create: `tests/jobs.test.mjs`
- Create: `tests/cli.test.mjs`

**Interfaces:**
- Produces `startJob`, `waitForJob`, `getJobStatus`, `getJobResult`, `cancelJob`, and `continueJob`.
- Background starts return `{ id, status: 'running' }`; `ask` returns its final result.
- Status vocabulary: `queued`, `running`, `done`, `failed`, `attention`, `cancel_pending`, `canceled`.

- [ ] **Step 1: Write failing lifecycle tests**

~~~js
test('starts a background job and wait returns its stored report', async t => {
  const request = await makeRequest(t, { persona: 'implement', scenario: 'complete' });
  const started = await startJob(request);
  assert.match(started.id, /^[a-f0-9-]{36}$/);
  assert.equal(started.status, 'running');
  const result = await waitForJob({ ...request, id: started.id, timeoutMs: 2_000 });
  assert.deepEqual(result, {
    status: 'done', text: 'finished safely', threadId: 'thread-test-1'
  });
});

test('continue refuses a job that lacks a captured thread', async t => {
  await assert.rejects(continueJob(await jobWithoutThread(t)), /no captured Codex thread/);
});
~~~

- [ ] **Step 2: Run the test to verify failure**

Run: `node --test tests/jobs.test.mjs tests/cli.test.mjs`

Expected: FAIL because the job orchestration module does not exist.

- [ ] **Step 3: Implement lifecycle operations and command dispatch**

~~~js
export async function startJob(request) {
  const workspace = await findWorkspace(request.workspace ?? process.cwd());
  const state = await ensureStateDirectory(workspace);
  const run = resolveRunOptions({ ...request, workspace });
  const job = await createJob(state, toJobSpec(run));
  const worker = await startCodex(run, makeStateHandlers(state, job.id));
  await transitionJob(state, job.id, { status: 'running', pid: worker.child.pid });
  void finalizeWorker(state, job.id, worker.completion);
  return run.persona === 'ask'
    ? waitForJob({ state, id: job.id })
    : { id: job.id, status: 'running' };
}
~~~

Implement `ask`, `run`, `wait`, `status`, `result`, `cancel`, and `continue` commands. `wait` must not cancel after a soft timeout. `status` must return bounded metadata/diagnostics only. `result` is the only lifecycle command that prints the full report. `continue` must invoke `codex exec resume <threadId>` in the saved workspace and reject running or threadless jobs. Support `--json` output and map every `BridgeError` to a deterministic exit code.

- [ ] **Step 4: Run verification**

Run: `npm test`

Run: `node bin/codex-bridge.mjs --version`

Expected: all tests PASS and version prints without contacting Codex.

- [ ] **Step 5: Commit**

~~~bash
git add src/core/jobs.mjs bin/codex-bridge.mjs tests/jobs.test.mjs tests/cli.test.mjs
git commit -m "feat: add durable Codex job CLI"
~~~

### Task 6: Add the MCP adapter, skills, plugin, and release documentation

**Files:**
- Create: `src/mcp/server.mjs`
- Create: `bin/codex-bridge-mcp.mjs`
- Create: `tests/mcp.test.mjs`
- Create: `skills/ask/SKILL.md`, `skills/research/SKILL.md`, `skills/review/SKILL.md`, `skills/implement/SKILL.md`, `skills/staffer/SKILL.md`, `skills/jobs/SKILL.md`
- Create: `.codex-plugin/plugin.json`
- Create: `docs/INSTALL.md`, `docs/SECURITY.md`, `README.md`
- Create: `tests/docs-contract.test.mjs`, `tests/smoke.test.mjs`

**Interfaces:**
- MCP exposes `codex_start`, `codex_wait`, `codex_status`, `codex_result`, `codex_cancel`, and `codex_continue`.
- Each MCP tool calls only a Task 5 core operation. Only `codex_result` may return the complete report.
- The smoke test executes only if `CODEX_BRIDGE_SMOKE=1`.

- [ ] **Step 1: Write failing MCP and user-facing contract tests**

~~~js
test('codex_start delegates to core and returns a stable job handle', async t => {
  const client = await connectMcp(t, { codexCommand: await createFakeCodex(t, 'complete') });
  const response = await client.callTool({
    name: 'codex_start', arguments: { persona: 'research', prompt: 'map this repo' }
  });
  const data = JSON.parse(response.content[0].text);
  assert.match(data.id, /^[a-f0-9-]{36}$/);
  assert.equal(data.status, 'running');
});

test('all persona skills state their command and collection behavior', async () => {
  for (const name of ['ask', 'research', 'review', 'implement', 'staffer']) {
    const skill = await fs.readFile('skills/' + name + '/SKILL.md', 'utf8');
    assert.match(skill, /codex-bridge/);
    assert.match(skill, /wait/);
  }
});
~~~

- [ ] **Step 2: Run tests to verify failure**

Run: `node --test tests/mcp.test.mjs tests/docs-contract.test.mjs tests/smoke.test.mjs`

Expected: FAIL because no MCP server, skills, or docs exist.

- [ ] **Step 3: Implement the MCP server and release surface**

~~~js
const server = new McpServer({ name: 'codex-bridge', version: '0.1.0' });
server.registerTool('codex_start', startSchema, async input => textResult(await startJob(input)));
server.registerTool('codex_wait', waitSchema, async input => textResult(await waitForJob(input)));
server.registerTool('codex_status', statusSchema, async input => textResult(await getJobStatus(input)));
server.registerTool('codex_result', resultSchema, async input => textResult(await getJobResult(input)));
server.registerTool('codex_cancel', cancelSchema, async input => textResult(await cancelJob(input)));
server.registerTool('codex_continue', continueSchema, async input => textResult(await continueJob(input)));
await server.connect(new StdioServerTransport());
~~~

Use SDK schemas for every parameter and convert `BridgeError` into MCP error content without leaking stack traces, prompts, environment values, or raw logs. Canonical skills must call the CLI with exactly one task source, wait for final results by default, and state that `status` is only for user-requested progress. The Codex plugin exposes those canonical skills.

`docs/INSTALL.md` must show direct CLI and MCP setup. `docs/SECURITY.md` must distinguish host permissions, Codex sandbox/approval, prompt guardrails, and untrusted workspaces. `README.md` must show both integration paths and link security guidance.

Implement the real smoke test as:

~~~js
test('real Codex ask smoke test', { skip: process.env.CODEX_BRIDGE_SMOKE !== '1' }, async () => {
  const result = await runBridge(['ask', '--prompt', 'Reply with exactly: OK']);
  assert.match(result.stdout, /\bOK\b/);
});
~~~

Run it in an empty temporary Git repository, using no write/network/bypass flags.

- [ ] **Step 4: Verify the complete offline release surface**

Run: `npm test`

Run: `git diff --check`

Expected: PASS; smoke test is SKIPPED; no whitespace errors.

- [ ] **Step 5: Commit**

~~~bash
git add src/mcp bin/codex-bridge-mcp.mjs skills .codex-plugin docs README.md tests package.json package-lock.json
git commit -m "feat: expose Codex Bridge through MCP and skills"
~~~

## Final repository naming handoff

When the user supplies the final repository/package name, update the root package name, README title and install commands, and plugin manifest in one patch. Do not invent an npm scope, create a remote repository, publish a package, or push a branch. Then run:

~~~bash
npm test
git diff --check
git status --short
~~~

## Plan self-review

| Spec requirement | Plan task |
| --- | --- |
| Universal CLI, Node 20+, Windows support | 1, 5 |
| Local atomic state and Git exclusion | 2 |
| Personas and safe default profiles | 3 |
| Codex JSONL execution, cancellation, continuation | 4, 5 |
| Background jobs and bounded progress | 5 |
| MCP adapter over the single core | 6 |
| Skills, plugin, documentation, offline tests | 6 |
| Opt-in real Codex smoke test | 6 |
| Final repository naming without publishing | Final handoff |

The plan defines every later interface in an earlier task, contains no deferred implementation marker, and covers every requirement from the design specification.
