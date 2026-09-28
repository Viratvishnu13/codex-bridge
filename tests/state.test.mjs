import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createJob, readJob, transitionJob } from '../src/core/state.mjs';

async function makeStateDirectory(t) {
  const state = await mkdtemp(path.join(tmpdir(), 'codex-bridge-state-'));
  t.after(() => rm(state, { recursive: true, force: true }));
  return state;
}

test('publishes a complete job using atomic state updates', async t => {
  const state = await makeStateDirectory(t);
  const job = await createJob(state, {
    workspace: state,
    persona: 'ask',
    profile: 'read-only',
    taskSource: 'prompt',
  });
  const running = await transitionJob(state, job.id, { status: 'running', pid: 1234 });

  assert.equal((await readJob(state, running.id)).status, 'running');
  assert.equal((await readdir(path.join(state, 'jobs'))).some(name => name.endsWith('.tmp')), false);
});

test('refuses to restart a terminal job', async t => {
  const state = await makeStateDirectory(t);
  const job = await createJob(state, {
    workspace: state,
    persona: 'ask',
    profile: 'read-only',
    taskSource: 'prompt',
  });
  await transitionJob(state, job.id, { status: 'done' });

  await assert.rejects(
    transitionJob(state, job.id, { status: 'running' }),
    /cannot transition terminal job/,
  );
});
