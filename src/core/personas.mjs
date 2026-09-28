import { BridgeError } from './errors.mjs';

export const PERSONAS = Object.freeze({
  ask: { execution: 'foreground', profile: 'read-only' },
  research: { execution: 'background', profile: 'read-only' },
  review: { execution: 'background', profile: 'read-only' },
  implement: { execution: 'background', profile: 'workspace-write' },
  staffer: { execution: 'background', profile: 'workspace-write' },
});

const profiles = Object.freeze({
  'read-only': { sandbox: 'read-only', approvalPolicy: 'never' },
  'workspace-write': { sandbox: 'workspace-write', approvalPolicy: 'never' },
});

export function resolveRunOptions(input) {
  const persona = input.persona ?? 'staffer';
  if (!PERSONAS[persona]) throw new BridgeError(`unknown persona: ${persona}`, 64);
  const profile = input.profile ?? PERSONAS[persona].profile;
  if (!profiles[profile]) throw new BridgeError(`unknown profile: ${profile}`, 64);
  if (!input.task?.trim()) throw new BridgeError('task text is required', 64);

  return {
    persona,
    profile,
    ...profiles[profile],
    task: input.task,
    taskSource: input.taskSource ?? 'prompt',
    model: input.model,
    workspace: input.workspace,
  };
}

export function buildWorkerPrompt({ persona, task }) {
  return [
    `You are the Codex Bridge ${persona} persona.`,
    'Preserve unrelated workspace changes. Do not commit, push, open a pull request,',
    'delete files outside the workspace, or make costly/network side effects unless the delegated task explicitly authorizes that exact action.',
    '<delegated-task>',
    task,
    '</delegated-task>',
  ].join('\n');
}
