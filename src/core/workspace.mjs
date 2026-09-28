import { access, appendFile, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';

async function exists(candidate) {
  try {
    await access(candidate);
    return true;
  } catch {
    return false;
  }
}

export async function findWorkspace(startPath) {
  let current = path.resolve(startPath);
  try {
    if (!(await stat(current)).isDirectory()) current = path.dirname(current);
  } catch {
    current = path.dirname(current);
  }

  while (true) {
    if (await exists(path.join(current, '.git'))) return current;
    const parent = path.dirname(current);
    if (parent === current) return path.resolve(startPath);
    current = parent;
  }
}

export async function ensureStateDirectory(workspace) {
  const state = path.join(workspace, '.codex-bridge');
  await mkdir(path.join(state, 'jobs'), { recursive: true });

  const exclude = path.join(workspace, '.git', 'info', 'exclude');
  if (await exists(exclude)) {
    const { readFile } = await import('node:fs/promises');
    const content = await readFile(exclude, 'utf8');
    if (!content.split(/\r?\n/).includes('.codex-bridge/')) {
      await appendFile(exclude, `${content.endsWith('\n') ? '' : '\n'}.codex-bridge/\n`, 'utf8');
    }
  }
  return state;
}
