import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCommand } from '../src/core/args.mjs';

test('task text is opaque even when it begins with a flag', () => {
  const parsed = parseCommand(['run', '--persona', 'research', '--prompt', '--json means what?'], '');
  assert.equal(parsed.task, '--json means what?');
  assert.equal(parsed.persona, 'research');
});

test('multiple task sources are rejected', () => {
  assert.throws(
    () => parseCommand(['run', '--prompt', 'a', '--stdin'], 'b'),
    /exactly one task source/,
  );
});
