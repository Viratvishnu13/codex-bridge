#!/usr/bin/env node

import { parseCommand, loadTask } from '../src/core/args.mjs';
import { startJob, waitForJob, getJobStatus, getJobResult, cancelJob } from '../src/core/jobs.mjs';
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
  if (['status', 'result', 'cancel'].includes(argv[0])) {
    const id = argv[1];
    const workspaceIndex = argv.indexOf('--workspace');
    const workspace = workspaceIndex === -1 ? process.cwd() : argv[workspaceIndex + 1];
    if (!id || (workspaceIndex !== -1 && !workspace)) throw new BridgeError('usage: <command> <job-id> [--workspace <path>]', 64);
    const state = await ensureStateDirectory(await findWorkspace(workspace));
    const operation = { status: getJobStatus, result: getJobResult, cancel: cancelJob }[argv[0]];
    process.stdout.write(`${JSON.stringify(await operation({ state, id }))}\n`);
    return;
  }
  const stdin = argv.includes('--stdin') ? await readStdin() : '';
  const parsed = await loadTask(parseCommand(argv, stdin));
  if (!['ask', 'run'].includes(parsed.command)) throw new BridgeError(`unsupported command: ${parsed.command}`, 64);
  const started = await startJob({
    ...parsed,
    persona: parsed.command === 'ask' ? 'ask' : parsed.persona,
    codexCommand: process.env.CODEX_BRIDGE_CODEX_COMMAND,
    codexPrefixArgs: process.env.CODEX_BRIDGE_CODEX_PREFIX
      ? JSON.parse(process.env.CODEX_BRIDGE_CODEX_PREFIX)
      : undefined,
  });
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
