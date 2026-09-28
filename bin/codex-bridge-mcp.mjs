#!/usr/bin/env node

import { runMcpServer } from '../src/mcp/server.mjs';

runMcpServer().catch(error => {
  process.stderr.write(`codex-bridge-mcp: ${error.message}\n`);
  process.exitCode = 1;
});
