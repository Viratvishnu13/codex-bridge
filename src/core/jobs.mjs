import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { BridgeError } from './errors.mjs';
import { findWorkspace, ensureStateDirectory } from './workspace.mjs';
import { createJob, readJob, transitionJob, writeResult } from './state.mjs';
import { resolveRunOptions, buildWorkerPrompt } from './personas.mjs';
import { preflightCodex, startCodex } from './codex-process.mjs';

const workers = new Map();

export async function startJob(request) {
  const workspace = await findWorkspace(request.workspace ?? process.cwd());
  const state = await ensureStateDirectory(workspace);
  await preflightCodex(request.codexCommand ?? 'codex');
  const run = resolveRunOptions({ ...request, workspace });
  const job = await createJob(state, run);
  const eventsPath = path.join(state, 'jobs', `${job.id}.events.jsonl`);
  const worker = await startCodex({
    ...run,
    task: buildWorkerPrompt(run),
    codexCommand: request.codexCommand,
    codexPrefixArgs: request.codexPrefixArgs,
    eventsPath,
  });
  await transitionJob(state, job.id, { status: 'running', pid: worker.child.pid });
  const key = `${state}:${job.id}`;
  workers.set(key, worker.completion.then(
    result => finish(state, job.id, result),
    error => fail(state, job.id, error),
  ));
  return { id: job.id, state, status: 'running' };
}

async function finish(state, id, result) {
  await writeResult(state, id, result.finalText);
  await transitionJob(state, id, {
    status: 'done', threadId: result.threadId, exitCode: result.exitCode, pid: null,
  });
  return result;
}

async function fail(state, id, error) {
  await transitionJob(state, id, { status: 'failed', pid: null, error: error.message });
  throw error;
}

export async function waitForJob({ state, id }) {
  const key = `${state}:${id}`;
  if (workers.has(key)) await workers.get(key);
  const job = await readJob(state, id);
  if (job.status !== 'done') throw new BridgeError(job.error ?? `job is ${job.status}`, 1);
  const text = await readFile(path.join(state, 'jobs', `${id}.result.md`), 'utf8');
  return { status: 'done', text, threadId: job.threadId };
}

export async function getJobStatus({ state, id }) {
  const job = await readJob(state, id);
  return { id: job.id, status: job.status, threadId: job.threadId, error: job.error };
}

export async function getJobResult({ state, id }) {
  const job = await readJob(state, id);
  if (job.status !== 'done') throw new BridgeError(job.error ?? `job is ${job.status}`, 1);
  const text = await readFile(path.join(state, 'jobs', `${id}.result.md`), 'utf8');
  return { id, status: job.status, text, threadId: job.threadId };
}

export async function cancelJob({ state, id }) {
  const job = await readJob(state, id);
  if (['done', 'failed', 'canceled'].includes(job.status)) return { id, status: job.status };
  if (!job.pid) throw new BridgeError('job has no owned process to cancel', 1);
  try {
    process.kill(job.pid);
    await transitionJob(state, id, { status: 'canceled', pid: null, error: 'canceled by caller' });
    return { id, status: 'canceled' };
  } catch (error) {
    await transitionJob(state, id, { status: 'cancel_pending', error: error.message });
    return { id, status: 'cancel_pending' };
  }
}
