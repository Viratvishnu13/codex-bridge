import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ensureStateDirectory, findWorkspace } from '../src/core/workspace.mjs';

const execFileAsync = promisify(execFile);

async function makeGitRepository(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'codex-bridge-workspace-'));
  await execFileAsync('git', ['init', '--quiet'], { cwd: root });
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test('uses a git root and ignores local bridge state without touching .gitignore', async t => {
  const root = await makeGitRepository(t);
  const nested = path.join(root, 'nested', 'dir');
  await mkdir(nested, { recursive: true });

  assert.equal(await findWorkspace(nested), root);
  const state = await ensureStateDirectory(root);
  assert.equal(state, path.join(root, '.codex-bridge'));
  assert.match(
    await readFile(path.join(root, '.git', 'info', 'exclude'), 'utf8'),
    /\.codex-bridge\//,
  );
  await assert.rejects(readFile(path.join(root, '.gitignore'), 'utf8'), { code: 'ENOENT' });
});
