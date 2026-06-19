import React, { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Activity,
  CalendarDays,
  ChevronDown,
  CircleDollarSign,
  DatabaseZap,
  Eye,
  Globe2,
  LayoutDashboard,
  LogOut,
  Moon,
  PauseCircle,
  PlayCircle,
  PlugZap,
  Plus,
  RefreshCcw,
  Trash2,
  ShieldCheck,
  UsersRound
} from 'lucide-react';
import './styles.css';

const datePresets = {
  Today: () => {
    const today = isoDate(new Date());
    return { from: today, to: today };
  },
  Yesterday: () => {
    const date = new Date();
    date.setDate(date.getDate() - 1);
    const yesterday = isoDate(date);
    return { from: yesterday, to: yesterday };
  },
  'This Month': () => {
    const date = new Date();
    return { from: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-01`, to: isoDate(date) };
  },
  'Last Month': () => {
    const date = new Date();
    const first = new Date(date.getFullYear(), date.getMonth() - 1, 1);
    const last = new Date(date.getFullYear(), date.getMonth(), 0);
    return { from: isoDate(first), to: isoDate(last) };
  }
};

function App() {
  const [user, setUser] = useState(null);
  const [theme, setTheme] = useState('dark');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadMe = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api('/api/me');
      setUser(result.user);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadMe();
  }, [loadMe]);

  async function handleLogin(credentials) {
    setError('');
    try {
      const result = await api('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify(credentials)
      });
      setUser(result.user);
    } catch (loginError) {
      setError(loginError.message || 'Login failed');
    }
  }

  async function handleLogout() {
    await api('/api/auth/logout', { method: 'POST' });
    setUser(null);
  }

  if (loading) return <Splash />;
  if (!user) return <LoginScreen onLogin={handleLogin} error={error} />;

  return (
    <Shell user={user} onLogout={handleLogout} theme={theme} onToggleTheme={() => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))}>
      {user.role === 'admin' ? <AdminConsole /> : <ClientDashboard />}
    </Shell>
  );
}

function Shell({ user, onLogout, theme, onToggleTheme, children }) {
  return (
    <div className={`app-shell ${theme === 'light' ? 'light-theme' : ''}`}>
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <strong>My Domains</strong>
        </div>
        <div className="topbar-actions">
          <button className="icon-button" type="button" title="Theme" onClick={onToggleTheme}>
            <Moon size={17} />
          </button>
          <div className="avatar" title={user.email}>{initials(user.name)}</div>
          <button className="icon-button" type="button" title="Logout" onClick={onLogout}>
            <LogOut size={17} />
          </button>
        </div>
      </header>
      <main>{children}</main>
      <footer className="footer">
        <span />
        <span>Developed with care by @Mara8</span>
      </footer>
    </div>
  );
}

function LoginScreen({ onLogin, error }) {
  const [email, setEmail] = useState('admin@example.com');
  const [password, setPassword] = useState('ChangeMe123!');
  const submitLogin = () => onLogin({ email, password });

  return (
    <div className="login-page">
      <section className="login-panel">
        <div className="brand login-brand">
          <div className="brand-mark" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <strong>My Domains</strong>
        </div>
        <h1>Sign in</h1>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            submitLogin();
          }}
        >
          <label htmlFor="login-email">
            Email
            <input id="login-email" value={email} onChange={(event) => setEmail(event.target.value)} />
          </label>
          <label htmlFor="login-password">
            Password
            <input
              id="login-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          {error ? <p className="form-error">{error}</p> : null}
          <button
            className="primary-button full"
            type="submit"
            onClick={(event) => {
              event.preventDefault();
              submitLogin();
            }}
          >
            Login
          </button>
        </form>
        <div className="login-hints">
          <button type="button" onClick={() => { setEmail('admin@example.com'); setPassword('ChangeMe123!'); }}>
            Admin demo
          </button>
          <button type="button" onClick={() => { setEmail('client@example.com'); setPassword('Client123!'); }}>
            Client demo
          </button>
        </div>
      </section>
    </div>
  );
}

function ClientDashboard() {
  const [range, setRange] = useDateRange();
  const [compactColumns, setCompactColumns] = useState(false);
  const [data, setData] = useState({ totals: {}, rows: [] });
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    const result = await api(`/api/client/dashboard?${rangeQuery(range)}`);
    setData(result);
    setLoading(false);
  }, [range]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <section className="workspace">
      <PageTitle title="Salary Dashboard" subtitle="My Domains" />
      <Controls range={range} setRange={setRange} onRefresh={load} onColumns={() => setCompactColumns((current) => !current)} />
      <MetricStrip totals={data.totals} />
      <DomainTable
        rows={data.rows}
        loading={loading}
        clientMode
        compact={compactColumns}
        onView={(row) => setSelected(row)}
      />
      {selected ? (
        <DetailDrawer row={selected} range={range} onClose={() => setSelected(null)} />
      ) : null}
    </section>
  );
}

function AdminConsole() {
  const [range, setRange] = useDateRange();
  const [view, setView] = useState('domains');
  const [compactColumns, setCompactColumns] = useState(false);
  const [overview, setOverview] = useState({ rows: [], totals: {}, latestSync: [] });
  const [clients, setClients] = useState([]);
  const [google, setGoogle] = useState({});
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [selectedDomain, setSelectedDomain] = useState(null);
  const [deleteDomain, setDeleteDomain] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [overviewResult, clientResult, googleResult] = await Promise.all([
      api(`/api/admin/overview?${rangeQuery(range)}`),
      api('/api/admin/clients'),
      api('/api/admin/google/status')
    ]);
    setOverview(overviewResult);
    setClients(clientResult.clients);
    setGoogle(googleResult);
    setLoading(false);
  }, [range]);

  useEffect(() => {
    load();
  }, [load]);

  async function sync() {
    setMessage('Sync running...');
    const result = await api('/api/admin/sync/google', {
      method: 'POST',
      body: JSON.stringify(range)
    });
    setMessage(result.ok ? `Synced ${result.rowsSynced} rows (${result.mode})` : result.error);
    await load();
  }

  async function deleteSubdomain(row) {
    await api(`/api/admin/subdomains/${row.id}`, { method: 'DELETE' });
    setDeleteDomain(null);
    await load();
  }

  return (
    <section className="workspace">
      <PageTitle title="Admin Console" subtitle="Clients, subdomains and AdX sync" />
      <Controls range={range} setRange={setRange} onRefresh={load} onColumns={() => setCompactColumns((current) => !current)}>
        <button className="primary-button" type="button" onClick={sync}>
          <DatabaseZap size={16} />
          Sync AdX
        </button>
      </Controls>
      <AdminStatus google={google} message={message} latestSync={overview.latestSync} />
      <MetricStrip totals={overview.totals} />
      <div className="view-tabs" role="tablist" aria-label="Admin sections">
        <button className={view === 'domains' ? 'tab active' : 'tab'} type="button" onClick={() => setView('domains')}>
          <LayoutDashboard size={15} />
          Domains
        </button>
        <button className={view === 'clients' ? 'tab active' : 'tab'} type="button" onClick={() => setView('clients')}>
          <UsersRound size={15} />
          Clients
        </button>
      </div>
      {view === 'clients' ? (
        <AdminForms clients={clients} onChanged={load} />
      ) : (
        <div className="panel table-panel">
          <div className="panel-heading">
            <div>
              <h2>AdX Domains</h2>
              <p>{overview.rows.length} tracked rows from Ad Manager</p>
            </div>
            <button className="ghost-button" type="button" onClick={() => setCompactColumns((current) => !current)}>
              Columns
              <ChevronDown size={15} />
            </button>
          </div>
          <DomainTable
            rows={overview.rows}
            loading={loading}
            compact={compactColumns}
            onView={(row) => setSelectedDomain(row)}
            onDelete={(row) => setDeleteDomain(row)}
          />
        </div>
      )}
      {selectedDomain ? (
        <DetailDrawer
          row={selectedDomain}
          range={range}
          dailyPath={`/api/admin/subdomains/${selectedDomain.id}/daily`}
          onClose={() => setSelectedDomain(null)}
        />
      ) : null}
      {deleteDomain ? (
        <ConfirmDialog
          title="Remove Subdomain"
          body={`Remove ${deleteDomain.domain}? Its assignments and stored metrics will be deleted.`}
          confirmLabel="Remove"
          onCancel={() => setDeleteDomain(null)}
          onConfirm={() => deleteSubdomain(deleteDomain)}
        />
      ) : null}
    </section>
  );
}

function AdminStatus({ google, message, latestSync }) {
  const latest = latestSync?.[0];
  const connectionLabel = google.needsReconnectForDateSync ? 'Reconnect for dates' : (google.connected ? 'Connected' : 'Not connected');
  const actionLabel = google.connected || google.needsReconnectForDateSync ? 'Reconnect' : 'Connect';
  return (
    <div className="status-rail">
      <div>
        <ShieldCheck size={18} />
        <span>Ad Manager</span>
        <strong>{connectionLabel}</strong>
        {google.hasClientConfig ? (
          <a className="inline-action" href="/api/admin/google/oauth/start">
            <PlugZap size={13} />
            {actionLabel}
          </a>
        ) : (
          <span className="inline-action disabled">
            <PlugZap size={13} />
            Configure
          </span>
        )}
      </div>
      <div>
        <RefreshCcw size={18} />
        <span>Sync</span>
        <strong>{latest ? latest.status : 'Ready'}</strong>
      </div>
      <div>
        <Activity size={18} />
        <span>Status</span>
        <strong>{message || latest?.message || 'Waiting'}</strong>
      </div>
    </div>
  );
}

function AdminForms({ clients, onChanged }) {
  const [resetting, setResetting] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [clearText, setClearText] = useState('');
  const [deleteClientTarget, setDeleteClientTarget] = useState(null);
  const [client, setClient] = useState({
    name: '',
    company: '',
    email: '',
    password: '',
    status: 'active',
    notes: ''
  });
  const [subdomain, setSubdomain] = useState({
    domain: '',
    category: 'Content',
    unitPrice: '25',
    rentStatus: 'active',
    notes: '',
    clientId: ''
  });

  async function createClient(event) {
    event.preventDefault();
    await api('/api/admin/clients', {
      method: 'POST',
      body: JSON.stringify(client)
    });
    setClient({ name: '', company: '', email: '', password: '', status: 'active', notes: '' });
    onChanged();
  }

  async function createSubdomain(event) {
    event.preventDefault();
    const created = await api('/api/admin/subdomains', {
      method: 'POST',
      body: JSON.stringify(subdomain)
    });
    if (subdomain.clientId) {
      await api(`/api/admin/subdomains/${created.subdomain.id}/assign`, {
        method: 'POST',
        body: JSON.stringify({ clientId: Number(subdomain.clientId) })
      });
    }
    setSubdomain({
      domain: '',
      category: 'Content',
      unitPrice: '25',
      rentStatus: 'active',
      notes: '',
      clientId: ''
    });
    onChanged();
  }

  async function updateClientStatus(item, status) {
    await api(`/api/admin/clients/${item.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        name: item.name,
        company: item.company || '',
        email: item.email,
        status,
        notes: item.notes || ''
      })
    });
    onChanged();
  }

  async function deleteClient(item) {
    await api(`/api/admin/clients/${item.id}`, { method: 'DELETE' });
    setDeleteClientTarget(null);
    onChanged();
  }

  async function clearWorkspace() {
    if (clearText !== 'CLEAR') return;
    setResetting(true);
    try {
      await api('/api/admin/workspace/clear', {
        method: 'POST',
        body: JSON.stringify({ confirm: 'CLEAR' })
      });
      setClearOpen(false);
      setClearText('');
      onChanged();
    } finally {
      setResetting(false);
    }
  }

  return (
    <div className="client-console">
      <div className="panel forms-panel">
        <div className="panel-heading">
          <div>
            <h2>Add Client</h2>
            <p>Create login access</p>
          </div>
          <UsersRound size={18} />
        </div>
        <form className="compact-form" onSubmit={createClient}>
          <input placeholder="Client name" value={client.name} onChange={setField(setClient, 'name')} required />
          <input placeholder="Company" value={client.company} onChange={setField(setClient, 'company')} />
          <input placeholder="Email" value={client.email} onChange={setField(setClient, 'email')} required />
          <input placeholder="Password" value={client.password} onChange={setField(setClient, 'password')} />
          <button className="secondary-button" type="submit">
            <Plus size={15} />
            Add Client
          </button>
        </form>
      </div>
      <div className="panel forms-panel">
        <div className="panel-heading">
          <div>
            <h2>Add Domain</h2>
            <p>Assign a rented subdomain</p>
          </div>
          <Globe2 size={18} />
        </div>
        <form className="compact-form" onSubmit={createSubdomain}>
          <input placeholder="sub.example.com" value={subdomain.domain} onChange={setField(setSubdomain, 'domain')} required />
          <input placeholder="Category" value={subdomain.category} onChange={setField(setSubdomain, 'category')} />
          <input placeholder="Unit price" type="number" value={subdomain.unitPrice} onChange={setField(setSubdomain, 'unitPrice')} />
          <select value={subdomain.clientId} onChange={setField(setSubdomain, 'clientId')}>
            <option value="">Unassigned</option>
            {clients.map((item) => (
              <option value={item.id} key={item.id}>{item.name}</option>
            ))}
          </select>
          <button className="secondary-button" type="submit">
            <Globe2 size={15} />
            Add Domain
          </button>
        </form>
      </div>
      <div className="panel client-table-panel">
        <div className="panel-heading">
          <div>
            <h2>Clients</h2>
            <p>{clients.length} accounts</p>
          </div>
          <button className="ghost-button danger-button" type="button" onClick={() => setClearOpen(true)} disabled={resetting}>
            <Trash2 size={15} />
            Clear Workspace
          </button>
        </div>
        <div className="client-list clean">
          {clients.map((item) => (
            <div className="client-row" key={item.id}>
              <div>
                <strong>{item.name}</strong>
                <span>{item.email}</span>
              </div>
              <em className={item.status}>{item.status}</em>
              <span>{item.subdomainCount} domains</span>
              <div className="row-actions">
                <button
                  className="row-action"
                  type="button"
                  title={item.status === 'active' ? 'Pause dashboard' : 'Activate dashboard'}
                  onClick={() => updateClientStatus(item, item.status === 'active' ? 'paused' : 'active')}
                >
                  {item.status === 'active' ? <PauseCircle size={15} /> : <PlayCircle size={15} />}
                </button>
                <button
                  className="row-action danger"
                  type="button"
                  title="Delete client"
                  onClick={() => setDeleteClientTarget(item)}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
      {clearOpen ? (
        <div className="confirm-panel" role="dialog" aria-modal="true" aria-label="Clear workspace">
          <div className="confirm-box">
            <h2>Clear Workspace</h2>
            <p>Remove all clients, subdomains, metrics and sync history. Admin access and Google OAuth stay connected.</p>
            <input
              placeholder="Type CLEAR"
              value={clearText}
              onChange={(event) => setClearText(event.target.value)}
              autoFocus
            />
            <div className="confirm-actions">
              <button className="ghost-button" type="button" onClick={() => { setClearOpen(false); setClearText(''); }}>
                Cancel
              </button>
              <button className="ghost-button danger-button" type="button" onClick={clearWorkspace} disabled={clearText !== 'CLEAR' || resetting}>
                Clear
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {deleteClientTarget ? (
        <ConfirmDialog
          title="Delete Client"
          body={`Delete ${deleteClientTarget.name}? Their login and domain assignments will be removed.`}
          confirmLabel="Delete"
          onCancel={() => setDeleteClientTarget(null)}
          onConfirm={() => deleteClient(deleteClientTarget)}
        />
      ) : null}
    </div>
  );
}

function ConfirmDialog({ title, body, confirmLabel, onCancel, onConfirm }) {
  const [busy, setBusy] = useState(false);

  async function confirm() {
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="confirm-panel" role="dialog" aria-modal="true" aria-label={title}>
      <div className="confirm-box">
        <h2>{title}</h2>
        <p>{body}</p>
        <div className="confirm-actions">
          <button className="ghost-button" type="button" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button className="ghost-button danger-button" type="button" onClick={confirm} disabled={busy}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function PageTitle({ title, subtitle }) {
  return (
    <div className="page-title">
      <h1>{title}</h1>
      <p>{subtitle}</p>
    </div>
  );
}

function Controls({ range, setRange, onRefresh, onColumns, children }) {
  function updateFrom(from) {
    setRange((current) => ({
      from,
      to: from > current.to ? from : current.to,
      preset: 'Custom'
    }));
  }

  function updateTo(to) {
    setRange((current) => ({
      from: to < current.from ? to : current.from,
      to,
      preset: 'Custom'
    }));
  }

  return (
    <div className="controls">
      <div className="date-input">
        <CalendarDays size={16} />
        <input
          type="date"
          value={range.from}
          onInput={(event) => updateFrom(event.currentTarget.value)}
          onChange={(event) => updateFrom(event.currentTarget.value)}
        />
        <span>-</span>
        <input
          type="date"
          value={range.to}
          onInput={(event) => updateTo(event.currentTarget.value)}
          onChange={(event) => updateTo(event.currentTarget.value)}
        />
      </div>
      <div className="preset-row">
        {Object.keys(datePresets).map((label) => (
          <button
            className={range.preset === label ? 'preset active' : 'preset'}
            type="button"
            key={label}
            onClick={() => setRange({ ...datePresets[label](), preset: label })}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="control-spacer" />
      {children}
      <button className="ghost-button" type="button" onClick={onRefresh}>
        <RefreshCcw size={15} />
        Refresh
      </button>
      <button className="ghost-button desktop-only" type="button" onClick={onColumns}>
        Columns
        <ChevronDown size={15} />
      </button>
    </div>
  );
}

function MetricStrip({ totals = {} }) {
  const stats = [
    { label: 'Revenue', value: money(totals.earnings), icon: CircleDollarSign },
    { label: 'Page Views', value: number(totals.pageViews), icon: LayoutDashboard },
    { label: 'AdX CTR', value: percent(totals.adxCtr), icon: Activity },
    { label: 'AdX eCPM', value: money(totals.adxEcpm), icon: DatabaseZap }
  ];
  return (
    <div className="metric-strip">
      {stats.map((stat) => (
        <div className="metric" key={stat.label}>
          <stat.icon size={17} />
          <span>{stat.label}</span>
          <strong>{stat.value}</strong>
        </div>
      ))}
    </div>
  );
}

function DomainTable({ rows, loading, clientMode, compact, onView, onDelete }) {
  const colSpan = (clientMode ? 6 : 7) + (compact ? 0 : 3);
  return (
    <div className="domain-table-wrap">
      <table className="domain-table">
        <thead>
          <tr>
            <th>Domain</th>
            {!clientMode ? <th>Client</th> : null}
            <th>Page Views</th>
            {!compact ? <th>Impressions</th> : null}
            {!compact ? <th>Clicks</th> : null}
            <th>AdX CTR</th>
            <th>AdX eCPM</th>
            <th>Revenue</th>
            {!compact ? <th>Source</th> : null}
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr><td className="empty" colSpan={colSpan}>Loading...</td></tr>
          ) : rows.length ? rows.map((row) => (
            <tr key={`${row.id}-${row.clientId || 'client'}`}>
              <td>
                <div className="domain-cell">
                  <Globe2 size={16} />
                  <span>{row.domain}</span>
                  <em>{row.rentStatus}</em>
                </div>
              </td>
              {!clientMode ? <td>{row.clientName || 'Unassigned'}</td> : null}
              <td>{number(row.pageViews)}</td>
              {!compact ? <td>{number(row.impressions)}</td> : null}
              {!compact ? <td>{number(row.clicks)}</td> : null}
              <td>{percent(row.adxCtr)}</td>
              <td>{money(row.adxEcpm)}</td>
              <td className="money">{money(row.earnings)}</td>
              {!compact ? <td><span className="source-pill">{row.source || 'empty'}</span></td> : null}
              <td>
                <div className="row-actions">
                  <button className="row-action" type="button" onClick={() => onView(row)} title="View">
                    <Eye size={15} />
                  </button>
                  {!clientMode && onDelete ? (
                    <button className="row-action danger" type="button" onClick={() => onDelete(row)} title="Remove subdomain">
                      <Trash2 size={15} />
                    </button>
                  ) : null}
                </div>
              </td>
            </tr>
          )) : (
            <tr><td className="empty" colSpan={colSpan}>No results.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function DetailDrawer({ row, range, dailyPath, onClose }) {
  const [daily, setDaily] = useState([]);

  useEffect(() => {
    const path = dailyPath || `/api/client/subdomains/${row.id}/daily`;
    api(`${path}?${rangeQuery(range)}`).then((result) => setDaily(result.rows));
  }, [row.id, range, dailyPath]);

  return (
    <aside className="drawer">
      <button className="drawer-backdrop" type="button" onClick={onClose} aria-label="Close details" />
      <div className="drawer-panel">
        <div className="panel-heading">
          <div>
            <h2>{row.domain}</h2>
            <p>{range.from} - {range.to}</p>
          </div>
          <button className="icon-button" type="button" onClick={onClose}>x</button>
        </div>
        <div className="mini-chart" aria-label="Daily earnings chart">
          {daily.map((day) => (
            <span
              key={day.date}
              style={{ height: `${Math.max(10, Math.min(100, day.earnings * 12))}%` }}
              title={`${day.date}: ${money(day.earnings)}`}
            />
          ))}
        </div>
        <div className="daily-list">
          {daily.map((day) => (
            <div key={day.date}>
              <span>{day.date}</span>
              <strong>{money(day.earnings)}</strong>
              <em>{number(day.pageViews)} views · {percent(day.adxCtr)} CTR</em>
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}

function Splash() {
  return (
    <div className="splash">
      <div className="brand-mark" aria-hidden="true"><span /><span /><span /></div>
    </div>
  );
}

function useDateRange() {
  return useState(() => ({ ...datePresets.Today(), preset: 'Today' }));
}

function setField(setter, field) {
  return (event) => setter((current) => ({ ...current, [field]: event.target.value }));
}

function rangeQuery(range) {
  return new URLSearchParams({ from: range.from, to: range.to }).toString();
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'include',
    ...options,
    headers: {
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(body.error || `Request failed: ${response.status}`);
  }
  return body;
}

function isoDate(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function pad(value) {
  return String(value).padStart(2, '0');
}

function initials(name) {
  return String(name || 'U').split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase();
}

function number(value) {
  return new Intl.NumberFormat().format(Math.round(Number(value || 0)));
}

function money(value) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'MAD' }).format(Number(value || 0));
}

function percent(value) {
  const numeric = Number(value || 0);
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(numeric > 1 ? numeric : numeric * 100)}%`;
}

createRoot(document.getElementById('root')).render(<App />);
