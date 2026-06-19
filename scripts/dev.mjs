import { spawn } from 'node:child_process';

const commands = [
  ['server', 'node', ['--watch', 'server/index.js']],
  ['client', 'vite', ['--host', '0.0.0.0']]
];

const children = commands.map(([name, command, args]) => {
  const child = spawn(command, args, {
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      NODE_ENV: process.env.NODE_ENV || 'development',
      PORT: process.env.PORT || '8080'
    }
  });

  child.stdout.on('data', (chunk) => process.stdout.write(`[${name}] ${chunk}`));
  child.stderr.on('data', (chunk) => process.stderr.write(`[${name}] ${chunk}`));
  child.on('exit', (code) => {
    if (code && !process.exitCode) process.exitCode = code;
    for (const other of children) {
      if (other !== child && !other.killed) other.kill();
    }
  });
  return child;
});

process.on('SIGINT', () => {
  for (const child of children) child.kill('SIGINT');
});

