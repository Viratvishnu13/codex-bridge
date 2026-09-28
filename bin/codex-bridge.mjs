#!/usr/bin/env node

import { parseCommand, loadTask } from '../src/core/args.mjs';
import { startJob, waitForJob } from '../src/core/jobs.mjs';
import { BridgeError } from '../src/core/errors.mjs';

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
  const stdin = argv.includes('--stdin') ? await readStdin() : '';
  const parsed = await loadTask(parseCommand(argv, stdin));
  if (parsed.command !== 'ask') throw new BridgeError(`unsupported command: ${parsed.command}`, 64);
  const started = await startJob({
    ...parsed,
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
