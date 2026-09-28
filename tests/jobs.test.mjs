import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createFakeCodex } from './helpers/fake-codex.mjs';
import { startJob, waitForJob } from '../src/core/jobs.mjs';

test('starts an ask job and persists its final report', async t => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'codex-bridge-job-'));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const executable = await createFakeCodex(t, 'complete');

  const started = await startJob({
    workspace,
    persona: 'ask',
    task: 'reply safely',
    taskSource: 'prompt',
    codexCommand: process.execPath,
    codexPrefixArgs: [executable],
  });
  const result = await waitForJob({ state: started.state, id: started.id });

  assert.deepEqual(result, {
    status: 'done', text: 'finished safely', threadId: 'thread-test-1',
  });
});
