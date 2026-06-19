const baseUrl = process.env.SMOKE_URL || 'http://localhost:8080';

const health = await fetch(`${baseUrl}/health`);
if (!health.ok) {
  throw new Error(`Health check failed: ${health.status}`);
}

const body = await health.json();
if (body.status !== 'ok') {
  throw new Error(`Unexpected health response: ${JSON.stringify(body)}`);
}

console.log(`Smoke passed for ${baseUrl}`);

