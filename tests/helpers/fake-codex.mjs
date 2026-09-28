import { chmod, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const scenarios = {
  complete: [
    { type: 'thread.started', thread_id: 'thread-test-1' },
    { type: 'item.completed', item: { type: 'agent_message', text: 'finished safely' } },
    { type: 'turn.completed', usage: { input_tokens: 1, output_tokens: 1 } },
  ],
  truncated: [{ type: 'thread.started', thread_id: 'thread-test-1' }],
  malformed: ['not-json'],
  failure: [{ type: 'error', message: 'worker failed' }],
  hang: [],
};

export async function createFakeCodex(t, scenario = 'complete') {
  const directory = await mkdtemp(path.join(tmpdir(), 'codex-bridge-test-'));
  const executable = path.join(directory, 'fake-codex.mjs');
  const records = scenarios[scenario];

  await writeFile(executable, [
    '#!/usr/bin/env node',
    "if (process.argv.includes('--version')) process.stdout.write('fake-codex 1.0.0\\n');",
    `for (const record of ${JSON.stringify(records)}) console.log(typeof record === 'string' ? record : JSON.stringify(record));`,
    scenario === 'failure' ? 'process.exitCode = 1;' : '',
    scenario === 'hang' ? 'setInterval(() => {}, 1000);' : '',
  ].filter(Boolean).join('\n'), 'utf8');
  await chmod(executable, 0o755);
  t.after(() => import('node:fs/promises').then(({ rm }) => rm(directory, { recursive: true, force: true })));
  return executable;
}
