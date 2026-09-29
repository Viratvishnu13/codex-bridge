#!/usr/bin/env node

import { parseCommand, loadTask } from '../src/core/args.mjs';
import { spawn } from 'node:child_process';
import { startJob, createPendingJob, executeExistingJob, waitForJob, getJobStatus, getJobResult, cancelJob, continueJob } from '../src/core/jobs.mjs';
import { BridgeError } from '../src/core/errors.mjs';
import { ensureStateDirectory, findWorkspace } from '../src/core/workspace.mjs';

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

async function main() {
  if (process.argv.includes('--version')) {
    process.stdout.write('codex-bridge 0.1.0\n');
    return;
  }

  const argv = process.argv.slice(2);
  if (argv[0] === 'worker') {
    const [,, state, id] = argv;
    if (!state || !id) throw new BridgeError('worker requires state and job id', 64);
    await executeExistingJob({ state, id });
    return;
  }
  if (['status', 'result', 'cancel', 'wait'].includes(argv[0])) {
    const id = argv[1];
    const workspaceIndex = argv.indexOf('--workspace');
    const workspace = workspaceIndex === -1 ? process.cwd() : argv[workspaceIndex + 1];
    if (!id || (workspaceIndex !== -1 && !workspace)) throw new BridgeError('usage: <command> <job-id> [--workspace <path>]', 64);
    const state = await ensureStateDirectory(await findWorkspace(workspace));
    const operation = { status: getJobStatus, result: getJobResult, cancel: cancelJob, wait: waitForJob }[argv[0]];
    process.stdout.write(`${JSON.stringify(await operation({ state, id }))}\n`);
    return;
  }
  const stdin = argv.includes('--stdin') ? await readStdin() : '';
  const parsed = await loadTask(parseCommand(argv, stdin));
  if (parsed.command === 'continue') {
    if (!parsed.job) throw new BridgeError('continue requires --job <job-id>', 64);
    const state = await ensureStateDirectory(await findWorkspace(parsed.workspace ?? process.cwd()));
    const started = await continueJob({ state, id: parsed.job, task: parsed.task });
    process.stdout.write(`${JSON.stringify(started)}\n`);
    return;
  }
  if (!['ask', 'run'].includes(parsed.command)) throw new BridgeError(`unsupported command: ${parsed.command}`, 64);
  const request = {
    ...parsed,
    persona: parsed.command === 'ask' ? 'ask' : parsed.persona,
    codexCommand: process.env.CODEX_BRIDGE_CODEX_COMMAND,
    codexPrefixArgs: process.env.CODEX_BRIDGE_CODEX_PREFIX
      ? JSON.parse(process.env.CODEX_BRIDGE_CODEX_PREFIX)
      : undefined,
  };
  if (parsed.command === 'run') {
    const started = await createPendingJob(request);
    const worker = spawn(process.execPath, [process.argv[1], 'worker', started.state, started.id], {
      detached: true, stdio: 'ignore', windowsHide: true, env: process.env,
    });
    worker.unref();
    process.stdout.write(`${JSON.stringify(started)}\n`);
    return;
  }
  const started = await startJob(request);
  const result = await waitForJob(started);
  process.stdout.write(`${result.text}\n`);
}

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`codex-bridge: ${message}\n`);
  process.exitCode = error instanceof BridgeError ? error.exitCode : 1;
}
