#!/usr/bin/env node

if (process.argv.includes('--version')) {
  process.stdout.write('codex-bridge 0.1.0\n');
} else {
  process.stderr.write('codex-bridge: command required\n');
  process.exitCode = 64;
}
