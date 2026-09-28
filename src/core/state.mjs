import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { BridgeError } from './errors.mjs';

const terminal = new Set(['done', 'failed', 'attention', 'canceled']);

function jobPath(state, id) {
  if (!/^[a-f0-9-]{36}$/i.test(id)) throw new BridgeError('invalid job id', 64);
  return path.join(state, 'jobs', `${id}.json`);
}

export async function writeAtomic(file, text) {
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, text, 'utf8');
  await rename(temporary, file);
}

export async function createJob(state, spec) {
  for (const field of ['workspace', 'persona', 'profile', 'taskSource']) {
    if (!spec[field]) throw new BridgeError(`missing job field: ${field}`, 64);
  }
  await mkdir(path.join(state, 'jobs'), { recursive: true });
  const now = new Date().toISOString();
  const job = {
    id: randomUUID(), version: 1, status: 'queued', ...spec,
    startedAt: now, updatedAt: now, threadId: null, pid: null,
    exitCode: null, error: null,
  };
  await writeAtomic(jobPath(state, job.id), `${JSON.stringify(job, null, 2)}\n`);
  return job;
}

export async function readJob(state, id) {
  return JSON.parse(await readFile(jobPath(state, id), 'utf8'));
}

export async function transitionJob(state, id, patch) {
  const current = await readJob(state, id);
  if (terminal.has(current.status) && patch.status === 'running') {
    throw new BridgeError('cannot transition terminal job to running', 64);
  }
  const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
  await writeAtomic(jobPath(state, id), `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

export async function writeResult(state, id, text) {
  if (!/^[a-f0-9-]{36}$/i.test(id)) throw new BridgeError('invalid job id', 64);
  await writeAtomic(path.join(state, 'jobs', `${id}.result.md`), text);
}
