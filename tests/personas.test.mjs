import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWorkerPrompt, resolveRunOptions } from '../src/core/personas.mjs';

test('review defaults to a read-only Codex profile', () => {
  const run = resolveRunOptions({ persona: 'review', task: 'Review the diff' });

  assert.equal(run.profile, 'read-only');
  assert.equal(run.sandbox, 'read-only');
  assert.equal(run.approvalPolicy, 'never');
});

test('worker prompt preserves the task verbatim within a delimiter', () => {
  const task = 'Keep "quotes"\nand --flags intact';
  assert.match(buildWorkerPrompt({ persona: 'research', task }), /<delegated-task>\nKeep "quotes"\nand --flags intact\n<\/delegated-task>/);
});
