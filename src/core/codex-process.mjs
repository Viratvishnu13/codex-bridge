import { appendFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { BridgeError } from './errors.mjs';

const execFileAsync = promisify(execFile);

function launch(command = 'codex') {
  if (process.platform === 'win32' && command === 'codex') {
    return {
      command: process.execPath,
      args: [path.join(process.env.APPDATA ?? '', 'npm', 'node_modules', '@openai', 'codex', 'bin', 'codex.js')],
    };
  }
  return { command, args: [] };
}

export async function preflightCodex(command = 'codex') {
  try {
    const target = launch(command);
    const { stdout } = await execFileAsync(target.command, [...target.args, '--version'], { windowsHide: true });
    return stdout.trim();
  } catch (error) {
    throw new BridgeError(`Codex preflight failed: ${error.message}`, 69);
  }
}

export async function startCodex(run) {
  const target = launch(run.codexCommand ?? 'codex');
  const args = [
    ...target.args,
    ...(run.codexPrefixArgs ?? []),
    '--sandbox', run.sandbox,
    '--ask-for-approval', run.approvalPolicy,
    'exec', '--json',
  ];
  if (run.model) args.push('--model', run.model);
  args.push(run.task);

  const child = spawn(target.command, args, {
    cwd: run.workspace,
    shell: false,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const completion = collect(child, run.eventsPath);
  return { child, completion, cancel: () => child.kill() };
}

async function collect(child, eventsPath) {
  let threadId = null;
  let finalText = null;
  let usage = null;
  let stderr = '';
  let append = Promise.resolve();
  const exit = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  const output = createInterface({ input: child.stdout, crlfDelay: Infinity });

  for await (const line of output) {
    append = append.then(() => appendFile(eventsPath, `${line}\n`, 'utf8'));
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      throw new BridgeError('Codex emitted malformed JSONL', 70);
    }
    if (event.type === 'thread.started' && typeof event.thread_id === 'string') threadId = event.thread_id;
    if (event.type === 'item.completed' && event.item?.type === 'agent_message') finalText = event.item.text ?? null;
    if (event.type === 'turn.completed') usage = event.usage ?? null;
  }

  child.stderr.setEncoding('utf8');
  child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-8192); });
  const exitCode = await exit;
  await append;
  if (exitCode !== 0) throw new BridgeError(`Codex exited with ${exitCode}${stderr ? `: ${stderr}` : ''}`, exitCode || 1);
  if (!finalText) throw new BridgeError('Codex completed without a final agent message', 70);
  return { threadId, finalText, usage, exitCode, eventsPath };
}

export function terminateCodex(worker) {
  return worker.child.kill();
}
