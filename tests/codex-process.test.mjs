import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createFakeCodex } from './helpers/fake-codex.mjs';
import { startCodex } from '../src/core/codex-process.mjs';

async function baseRun(t, scenario) {
  const executable = await createFakeCodex(t, scenario);
  const directory = await mkdtemp(path.join(tmpdir(), 'codex-bridge-events-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return {
    codexCommand: process.execPath,
    codexPrefixArgs: [executable],
    workspace: directory,
    sandbox: 'read-only',
    approvalPolicy: 'never',
    task: 'quote " --model x',
    eventsPath: path.join(directory, 'events.jsonl'),
  };
}

test('passes task text as one argv item and captures final JSONL message', async t => {
  const run = await baseRun(t, 'complete');
  const worker = await startCodex(run);
  const result = await worker.completion;

  assert.equal(result.threadId, 'thread-test-1');
  assert.equal(result.finalText, 'finished safely');
  assert.equal((await readFile(run.eventsPath, 'utf8')).includes('thread.started'), true);
});

test('fails when JSONL ends without a final agent message', async t => {
  const run = await baseRun(t, 'truncated');
  await assert.rejects((await startCodex(run)).completion, /final agent message/);
});
