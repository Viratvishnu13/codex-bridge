import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

test('CLI reports its version without launching Codex', async () => {
  const { stdout } = await execFileAsync(
    process.execPath,
    ['bin/codex-bridge.mjs', '--version'],
  );

  assert.equal(stdout, 'codex-bridge 0.1.0\n');
});
