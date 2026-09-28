import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createFakeCodex } from './helpers/fake-codex.mjs';

const execFileAsync = promisify(execFile);

test('CLI reports its version without launching Codex', async () => {
  const { stdout } = await execFileAsync(
    process.execPath,
    ['bin/codex-bridge.mjs', '--version'],
  );

  assert.equal(stdout, 'codex-bridge 0.1.0\n');
});

test('CLI asks Codex through the core job lifecycle', async t => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'codex-bridge-cli-'));
  const executable = await createFakeCodex(t, 'complete');
  t.after(() => rm(workspace, { recursive: true, force: true }));

  const { stdout } = await execFileAsync(process.execPath, [
    'bin/codex-bridge.mjs', 'ask', '--prompt', 'reply with OK', '--workspace', workspace,
  ], {
    env: {
      ...process.env,
      CODEX_BRIDGE_CODEX_COMMAND: process.execPath,
      CODEX_BRIDGE_CODEX_PREFIX: JSON.stringify([executable]),
    },
  });
  assert.match(stdout, /finished safely/);
});
