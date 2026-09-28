import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import * as z from 'zod/v4';
import { startJob, waitForJob } from '../core/jobs.mjs';

function text(value) {
  return { content: [{ type: 'text', text: value }] };
}

export function createMcpServer() {
  const server = new McpServer({ name: 'codex-bridge', version: '0.1.0' });
  server.registerTool('codex_ask', {
    description: 'Run a bounded, read-only Codex task in the supplied workspace and return its final report.',
    inputSchema: {
      prompt: z.string().min(1),
      workspace: z.string().optional(),
      model: z.string().optional(),
    },
  }, async ({ prompt, workspace, model }) => {
    try {
      const started = await startJob({
        persona: 'ask', task: prompt, taskSource: 'prompt', workspace, model,
      });
      const result = await waitForJob(started);
      return text(result.text);
    } catch (error) {
      return { isError: true, ...text(error instanceof Error ? error.message : String(error)) };
    }
  });
  return server;
}

export async function runMcpServer() {
  const server = createMcpServer();
  await server.connect(new StdioServerTransport());
}
