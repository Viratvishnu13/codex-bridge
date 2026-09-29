import { readFile } from 'node:fs/promises';
import { BridgeError } from './errors.mjs';

const valueOptions = new Set(['--persona', '--prompt', '--prompt-file', '--model', '--workspace', '--profile', '--job']);

export function parseCommand(argv, stdin = '') {
  const [command, ...options] = argv;
  if (!command) throw new BridgeError('command required', 64);
  const parsed = { command };
  let useStdin = false;

  for (let index = 0; index < options.length; index += 1) {
    const option = options[index];
    if (option === '--stdin') {
      if (useStdin) throw new BridgeError('duplicate --stdin', 64);
      useStdin = true;
      continue;
    }
    if (!valueOptions.has(option)) throw new BridgeError(`unknown option: ${option}`, 64);
    const value = options[++index];
    if (value === undefined) throw new BridgeError(`missing value for ${option}`, 64);
    const key = option.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    if (parsed[key] !== undefined) throw new BridgeError(`duplicate option: ${option}`, 64);
    parsed[key] = value;
  }

  const sources = [parsed.prompt !== undefined, parsed.promptFile !== undefined, useStdin].filter(Boolean).length;
  if (sources !== 1) throw new BridgeError('provide task text from exactly one task source', 64);
  if (useStdin) {
    parsed.task = stdin;
    parsed.taskSource = 'stdin';
  } else if (parsed.prompt !== undefined) {
    parsed.task = parsed.prompt;
    parsed.taskSource = 'prompt';
  } else {
    parsed.taskSource = 'prompt-file';
  }
  if (parsed.task !== undefined && !parsed.task.trim()) throw new BridgeError('task text is required', 64);
  return parsed;
}

export async function loadTask(parsed) {
  if (parsed.taskSource === 'prompt-file') {
    const task = await readFile(parsed.promptFile, 'utf8');
    if (!task.trim()) throw new BridgeError('task text is required', 64);
    return { ...parsed, task };
  }
  return parsed;
}
