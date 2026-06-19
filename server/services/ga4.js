export async function fetchGa4DomainReport({ accessToken, propertyId, from, to }) {
  if (!accessToken || !propertyId) return [];

  const response = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      dateRanges: [{ startDate: from, endDate: to }],
      dimensions: [{ name: 'date' }, { name: 'hostName' }],
      metrics: [
        { name: 'activeUsers' },
        { name: 'screenPageViews' },
        { name: 'bounceRate' },
        { name: 'engagedSessions' }
      ]
    })
  });

  if (!response.ok) {
    throw new Error(`GA4 report failed: ${response.status} ${await response.text()}`);
  }

  const payload = await response.json();
  return normalizeGa4Rows(payload);
}

export function normalizeGa4Rows(payload) {
  return (payload.rows || []).map((row) => ({
    date: normalizeDate(row.dimensionValues?.[0]?.value || ''),
    domain: row.dimensionValues?.[1]?.value || '',
    activeUsers: Number(row.metricValues?.[0]?.value || 0),
    pageViews: Number(row.metricValues?.[1]?.value || 0),
    bounceRate: Number(row.metricValues?.[2]?.value || 0),
    engagedSessions: Number(row.metricValues?.[3]?.value || 0)
  })).filter((row) => row.domain);
}

function normalizeDate(value) {
  if (/^\d{8}$/.test(value)) {
    return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
  }
  return value || new Date().toISOString().slice(0, 10);
}
