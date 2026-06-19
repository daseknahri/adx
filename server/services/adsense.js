export async function fetchAdsenseDomainReport({ accessToken, accountId, from, to }) {
  if (!accessToken || !accountId) return [];

  const params = new URLSearchParams();
  params.set('dateRange', 'CUSTOM');
  params.set('startDate.year', from.slice(0, 4));
  params.set('startDate.month', String(Number(from.slice(5, 7))));
  params.set('startDate.day', String(Number(from.slice(8, 10))));
  params.set('endDate.year', to.slice(0, 4));
  params.set('endDate.month', String(Number(to.slice(5, 7))));
  params.set('endDate.day', String(Number(to.slice(8, 10))));
  params.append('dimensions', 'DATE');
  params.append('dimensions', 'DOMAIN_NAME');

  const metricParams = [
    'ESTIMATED_EARNINGS',
    'PAGE_VIEWS',
    'CLICKS',
    'IMPRESSIONS',
    'PAGE_VIEWS_RPM'
  ];
  for (const metric of metricParams) params.append('metrics', metric);

  const url = `https://adsense.googleapis.com/v2/${accountId}/reports:generate?${params.toString()}`;
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${accessToken}` }
  });

  if (!response.ok) {
    throw new Error(`AdSense report failed: ${response.status} ${await response.text()}`);
  }

  const payload = await response.json();
  return normalizeAdsenseRows(payload);
}

export function normalizeAdsenseRows(payload) {
  const headers = payload.headers || [];
  const rows = payload.rows || [];
  const indexes = new Map(headers.map((header, index) => [header.name, index]));

  return rows.map((row) => {
    const cells = row.cells || [];
    const value = (name) => cells[indexes.get(name)]?.value || '';
    return {
      date: normalizeDate(value('DATE')),
      domain: value('DOMAIN_NAME'),
      earnings: Number(value('ESTIMATED_EARNINGS') || 0),
      pageViews: Number(value('PAGE_VIEWS') || 0),
      clicks: Number(value('CLICKS') || 0),
      impressions: Number(value('IMPRESSIONS') || 0),
      rpm: Number(value('PAGE_VIEWS_RPM') || 0)
    };
  }).filter((row) => row.domain);
}

function normalizeDate(value) {
  if (/^\d{8}$/.test(value)) {
    return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
  }
  return value || new Date().toISOString().slice(0, 10);
}
