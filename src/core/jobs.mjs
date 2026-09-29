import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { BridgeError } from './errors.mjs';
import { findWorkspace, ensureStateDirectory } from './workspace.mjs';
import { createJob, readJob, transitionJob, writeResult } from './state.mjs';
import { resolveRunOptions, buildWorkerPrompt } from './personas.mjs';
import { preflightCodex, startCodex } from './codex-process.mjs';

const workers = new Map();

export async function startJob(request) {
  const prepared = await createPendingJob(request);
  return executeExistingJob(prepared);
}

export async function createPendingJob(request) {
  const workspace = await findWorkspace(request.workspace ?? process.cwd());
  const state = await ensureStateDirectory(workspace);
  await preflightCodex(request.codexCommand ?? 'codex');
  const run = resolveRunOptions({ ...request, workspace });
  run.codexCommand = request.codexCommand;
  run.codexPrefixArgs = request.codexPrefixArgs;
  const job = await createJob(state, run);
  return { id: job.id, state, status: 'queued' };
}

export async function executeExistingJob({ state, id }) {
  const job = await readJob(state, id);
  if (job.status !== 'queued') throw new BridgeError(`job is ${job.status}`, 1);
  const eventsPath = path.join(state, 'jobs', `${job.id}.events.jsonl`);
  const worker = await startCodex({
    ...job,
    task: buildWorkerPrompt(job),
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

export async function waitForJob({ state, id, timeoutMs = 600_000 }) {
  const key = `${state}:${id}`;
  if (workers.has(key)) await workers.get(key);
  const deadline = Date.now() + timeoutMs;
  let job = await readJob(state, id);
  while (['queued', 'running'].includes(job.status) && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 100));
    job = await readJob(state, id);
  }
  if (['queued', 'running'].includes(job.status)) return { id, status: job.status };
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

export async function continueJob({ state, id, task }) {
  const previous = await readJob(state, id);
  if (!previous.threadId) throw new BridgeError('job has no captured Codex thread', 64);
  if (!task?.trim()) throw new BridgeError('continuation task is required', 64);
  const next = await createJob(state, {
    workspace: previous.workspace, persona: previous.persona, profile: previous.profile,
    taskSource: 'prompt', task, model: previous.model, resumeThreadId: previous.threadId,
  });
  return executeExistingJob({ state, id: next.id });
}
