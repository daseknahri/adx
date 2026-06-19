const port = process.env.PORT || '8080';
const url = process.env.CRON_SYNC_URL || `http://127.0.0.1:${port}/api/cron/sync/google/latest`;
const secret = process.env.CRON_SECRET || '';

if (!secret) {
  console.error('CRON_SECRET is not configured.');
  process.exit(1);
}

try {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${secret}`
    }
  });
  const text = await response.text();
  console.log(text);
  if (!response.ok) process.exit(1);
} catch (error) {
  console.error(error);
  process.exit(1);
}
