import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Activity,
  CalendarDays,
  ChevronDown,
  CircleDollarSign,
  DatabaseZap,
  Eye,
  EyeOff,
  Globe2,
  LayoutDashboard,
  ListPlus,
  LogOut,
  Moon,
  Pencil,
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
  'All Time': () => ({
    from: '',
    to: ''
  }),
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
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
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
            <input id="login-email" type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required />
          </label>
          <label htmlFor="login-password">
            Password
            <PasswordInput
              id="login-password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
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
      </section>
    </div>
  );
}

function PasswordInput({ id, ...props }) {
  const [visible, setVisible] = useState(false);
  const label = visible ? 'Hide password' : 'Show password';

  return (
    <span className="password-input">
      <input id={id} type={visible ? 'text' : 'password'} {...props} />
      <button type="button" className="password-toggle" aria-label={label} title={label} onClick={() => setVisible((value) => !value)}>
        {visible ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </span>
  );
}

function ClientDashboard() {
  const [range, setRange] = useDateRange();
  const [compactColumns, setCompactColumns] = useState(false);
  const [data, setData] = useState({ totals: {}, rows: [] });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastLoadedAt, setLastLoadedAt] = useState(null);
  const [selected, setSelected] = useState(null);
  const [accessError, setAccessError] = useState('');

  const load = useCallback(async ({ silent = false } = {}) => {
    if (silent) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    try {
      const result = await api(pathWithRange('/api/client/dashboard', range));
      setData(result);
      setAccessError('');
      setLastLoadedAt(new Date());
    } catch (error) {
      setAccessError(error.message || 'Unable to load dashboard');
    } finally {
      if (silent) {
        setRefreshing(false);
      } else {
        setLoading(false);
      }
    }
  }, [range]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const refreshTimer = window.setInterval(() => {
      if (document.visibilityState === 'visible') load({ silent: true });
    }, 15_000);
    return () => window.clearInterval(refreshTimer);
  }, [load]);

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') load({ silent: true });
    };
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('focus', handleVisibility);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('focus', handleVisibility);
    };
  }, [load]);

  if (accessError === 'client_paused') {
    return (
      <section className="workspace">
        <PageTitle title="Dashboard Paused" subtitle="Your access is temporarily unavailable." />
      </section>
    );
  }

  return (
    <section className="workspace">
      <PageTitle title="Salary Dashboard" subtitle="My Domains" />
      <Controls
        range={range}
        effectiveRange={data.range}
        setRange={setRange}
        onRefresh={() => load({ silent: true })}
        refreshLabel={refreshing ? 'Updating' : 'Refresh'}
        refreshDisabled={refreshing}
        onColumns={() => setCompactColumns((current) => !current)}
      >
        <ClientFreshness syncSummary={data.syncSummary} lastLoadedAt={lastLoadedAt} />
      </Controls>
      <MetricStrip totals={data.totals} clientMode />
      <DomainTable
        rows={data.rows}
        totals={data.totals}
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
  const [tableSearch, setTableSearch] = useState('');
  const [compactColumns, setCompactColumns] = useState(false);
  const [overview, setOverview] = useState({ rows: [], totals: {}, latestSync: [], syncSummary: {} });
  const [clients, setClients] = useState([]);
  const [google, setGoogle] = useState({});
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState('');
  const [selectedDomain, setSelectedDomain] = useState(null);
  const [editDomain, setEditDomain] = useState(null);
  const [deleteDomain, setDeleteDomain] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [overviewResult, clientResult, googleResult] = await Promise.all([
      api(pathWithRange('/api/admin/overview', range)),
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

  async function syncRange() {
    await runSync('Syncing selected range...', '/api/admin/sync/google', range);
  }

  async function refreshLatest() {
    await runSync('Refreshing latest AdX data...', '/api/admin/sync/google/latest');
  }

  async function backfillSites() {
    await runSync('Backfilling tracked sites from stored history...', '/api/admin/sync/google/backfill');
  }

  async function runSync(startMessage, path, body) {
    setSyncing(true);
    setMessage(startMessage);
    try {
      const result = await api(path, {
        method: 'POST',
        ...(body ? { body: JSON.stringify(body) } : {})
      });
      setMessage(result.ok ? syncMessage(result) : result.error);
      await load();
    } catch (syncError) {
      setMessage(syncError.message || 'Sync failed');
    } finally {
      setSyncing(false);
    }
  }

  async function deleteSubdomain(row) {
    await api(`/api/admin/subdomains/${row.id}`, { method: 'DELETE' });
    setDeleteDomain(null);
    await load();
  }

  async function updateSubdomain(row, values) {
    await api(`/api/admin/subdomains/${row.id}`, {
      method: 'PATCH',
      body: JSON.stringify(values)
    });
    const nextClientId = Number(values.clientId || 0);
    const currentClientId = Number(row.clientId || 0);
    if (
      currentClientId !== nextClientId ||
      Number(row.ownerCutPercent || 0) !== Number(values.ownerCutPercent || 0)
    ) {
      await api(`/api/admin/subdomains/${row.id}/assignment`, {
        method: 'PUT',
        body: JSON.stringify({
          clientId: nextClientId || null,
          ownerCutPercent: values.ownerCutPercent
        })
      });
    }
    setEditDomain(null);
    await load();
  }

  const visibleRows = useMemo(() => filterRows(overview.rows, tableSearch), [overview.rows, tableSearch]);

  return (
    <section className="workspace">
      <PageTitle title="Admin Console" subtitle="Clients, subdomains and AdX sync" />
      <Controls
        range={range}
        effectiveRange={overview.range}
        setRange={setRange}
        onRefresh={refreshLatest}
        refreshLabel="Refresh AdX"
        refreshDisabled={syncing}
        onColumns={() => setCompactColumns((current) => !current)}
      >
        <button className="ghost-button" type="button" onClick={backfillSites} disabled={syncing}>
          <RefreshCcw size={16} />
          Backfill Sites
        </button>
        <button className="primary-button" type="button" onClick={syncRange} disabled={syncing}>
          <DatabaseZap size={16} />
          Sync Range
        </button>
      </Controls>
      <AdminStatus google={google} message={message} latestSync={overview.latestSync} syncSummary={overview.syncSummary} />
      <SyncHistory runs={overview.latestSync} />
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
              <p>{visibleRows.length} of {overview.rows.length} tracked domains</p>
            </div>
            <div className="table-tools">
              <input
                className="search-input"
                placeholder="Search domains or clients"
                value={tableSearch}
                onChange={(event) => setTableSearch(event.target.value)}
              />
              <button className="ghost-button" type="button" onClick={() => setCompactColumns((current) => !current)}>
                Columns
                <ChevronDown size={15} />
              </button>
            </div>
          </div>
          <DomainTable
            rows={visibleRows}
            loading={loading}
            compact={compactColumns}
            onView={(row) => setSelectedDomain(row)}
            onEdit={(row) => setEditDomain(row)}
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
      {editDomain ? (
        <EditDomainDialog
          row={editDomain}
          clients={clients}
          onCancel={() => setEditDomain(null)}
          onSave={(values) => updateSubdomain(editDomain, values)}
        />
      ) : null}
    </section>
  );
}

function AdminStatus({ google, message, latestSync, syncSummary = {} }) {
  const latest = latestSync?.[0];
  const connectionLabel = google.needsReconnectForDateSync ? 'Reconnect for dates' : (google.connected ? 'Connected' : 'Not connected');
  const actionLabel = google.connected || google.needsReconnectForDateSync ? 'Reconnect' : 'Connect';
  const freshnessLabel = syncSummary.latestMetricDate
    ? `${syncSummary.latestMetricDate}${syncSummary.staleDays ? ` (${syncSummary.staleDays}d old)` : ''}`
    : 'No data';
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
        <span>Data Freshness</span>
        <strong>{freshnessLabel}</strong>
      </div>
      <div>
        <Activity size={18} />
        <span>Status</span>
        <strong>{message || latest?.message || 'Waiting'}</strong>
      </div>
    </div>
  );
}

function SyncHistory({ runs = [] }) {
  if (!runs.length) return null;
  return (
    <div className="sync-history" aria-label="Recent sync history">
      {runs.slice(0, 4).map((run, index) => (
        <div className={`sync-run ${run.status}`} key={`${run.startedAt}-${index}`}>
          <span>{run.status}</span>
          <strong>{number(run.rowsSynced)} rows</strong>
          <em>{formatDateTime(run.finishedAt || run.startedAt)}</em>
        </div>
      ))}
    </div>
  );
}

function syncMessage(result) {
  const rangeText = result.range ? ` ${result.range.from} - ${result.range.to}` : '';
  const stats = result.stats || {};
  const details = [];
  if (stats.adRowsReturned || stats.analyticsRowsReturned) {
    details.push(`${number(Number(stats.adRowsReturned || 0) + Number(stats.analyticsRowsReturned || 0))} returned`);
  }
  if (stats.unmatchedRows) details.push(`${number(stats.unmatchedRows)} unmatched`);
  if (stats.skippedEmptyRows) details.push(`${number(stats.skippedEmptyRows)} unchanged`);
  const detailText = details.length ? ` - ${details.join(' - ')}` : '';
  return `Synced ${number(result.rowsSynced)} rows (${result.mode})${detailText}${rangeText}`;
}

function AdminForms({ clients, onChanged }) {
  const [resetting, setResetting] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [clearText, setClearText] = useState('');
  const [editClientTarget, setEditClientTarget] = useState(null);
  const [deleteClientTarget, setDeleteClientTarget] = useState(null);
  const [assignmentClientTarget, setAssignmentClientTarget] = useState(null);
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
    unitPrice: '0',
    rentStatus: 'active',
    notes: '',
    clientId: '',
    ownerCutPercent: '20'
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
        body: JSON.stringify({
          clientId: Number(subdomain.clientId),
          ownerCutPercent: subdomain.ownerCutPercent
        })
      });
    }
    setSubdomain({
      domain: '',
      category: 'Content',
      unitPrice: '0',
      rentStatus: 'active',
      notes: '',
      clientId: '',
      ownerCutPercent: '20'
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

  async function updateClient(item, values) {
    await api(`/api/admin/clients/${item.id}`, {
      method: 'PATCH',
      body: JSON.stringify(values)
    });
    setEditClientTarget(null);
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
          <label>
            Name
            <input placeholder="Client name" value={client.name} onChange={setField(setClient, 'name')} required />
          </label>
          <label>
            Company
            <input placeholder="Company" value={client.company} onChange={setField(setClient, 'company')} />
          </label>
          <label>
            Email
            <input placeholder="Email" type="email" value={client.email} onChange={setField(setClient, 'email')} required />
          </label>
          <label>
            Initial password
            <PasswordInput placeholder="Password" autoComplete="new-password" value={client.password} onChange={setField(setClient, 'password')} />
          </label>
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
          <label>
            Domain
            <input placeholder="sub.example.com" value={subdomain.domain} onChange={setField(setSubdomain, 'domain')} required />
          </label>
          <label>
            Client
            <select value={subdomain.clientId} onChange={setField(setSubdomain, 'clientId')}>
              <option value="">Unassigned</option>
              {clients.map((item) => (
                <option value={item.id} key={item.id}>{item.name}</option>
              ))}
            </select>
          </label>
          <label>
            Your cut (%)
            <input
              type="number"
              min="0"
              max="100"
              step="0.01"
              value={subdomain.ownerCutPercent}
              onChange={setField(setSubdomain, 'ownerCutPercent')}
              disabled={!subdomain.clientId}
            />
          </label>
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
                  title="Manage client subdomains"
                  onClick={() => setAssignmentClientTarget(item)}
                >
                  <ListPlus size={15} />
                </button>
                <button
                  className="row-action"
                  type="button"
                  title="Edit client"
                  onClick={() => setEditClientTarget(item)}
                >
                  <Pencil size={15} />
                </button>
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
      {editClientTarget ? (
        <EditClientDialog
          row={editClientTarget}
          onCancel={() => setEditClientTarget(null)}
          onSave={(values) => updateClient(editClientTarget, values)}
        />
      ) : null}
      {assignmentClientTarget ? (
        <ClientDomainsDialog
          client={assignmentClientTarget}
          onCancel={() => setAssignmentClientTarget(null)}
          onChanged={onChanged}
        />
      ) : null}
    </div>
  );
}

function EditClientDialog({ row, onCancel, onSave }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [values, setValues] = useState(() => ({
    name: row.name || '',
    company: row.company || '',
    email: row.email || '',
    status: row.status || 'active',
    notes: row.notes || '',
    password: ''
  }));

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const payload = { ...values };
      if (!payload.password) delete payload.password;
      await onSave(payload);
    } catch (saveError) {
      setError(saveError.message || 'Update failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="confirm-panel" role="dialog" aria-modal="true" aria-label="Edit client">
      <form className="confirm-box edit-box" onSubmit={submit}>
        <h2>Edit Client</h2>
        <div className="edit-form">
          <label>
            Name
            <input value={values.name} onChange={setField(setValues, 'name')} required />
          </label>
          <label>
            Company
            <input value={values.company} onChange={setField(setValues, 'company')} />
          </label>
          <label>
            Email
            <input type="email" value={values.email} onChange={setField(setValues, 'email')} required />
          </label>
          <label>
            Status
            <select value={values.status} onChange={setField(setValues, 'status')}>
              <option value="active">active</option>
              <option value="paused">paused</option>
              <option value="ended">ended</option>
            </select>
          </label>
          <label>
            Notes
            <input value={values.notes} onChange={setField(setValues, 'notes')} />
          </label>
          <label>
            New password
            <PasswordInput
              placeholder="Leave empty to keep current"
              autoComplete="new-password"
              value={values.password}
              onChange={setField(setValues, 'password')}
            />
          </label>
        </div>
        {error ? <p className="form-error">{error}</p> : null}
        <div className="confirm-actions">
          <button className="ghost-button" type="button" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button className="primary-button" type="submit" disabled={busy}>
            Save
          </button>
        </div>
      </form>
    </div>
  );
}

function ClientDomainsDialog({ client, onCancel, onChanged }) {
  const [data, setData] = useState({ assigned: [], available: [] });
  const [selectedDomainId, setSelectedDomainId] = useState('');
  const [ownerCutPercent, setOwnerCutPercent] = useState('20');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const result = await api(`/api/admin/clients/${client.id}/subdomains`);
    setData(result);
  }, [client.id]);

  useEffect(() => {
    load().catch((loadError) => setError(loadError.message || 'Unable to load subdomains'));
  }, [load]);

  async function addDomain(event) {
    event.preventDefault();
    if (!selectedDomainId) return;
    setBusy(true);
    setError('');
    try {
      await api(`/api/admin/subdomains/${selectedDomainId}/assignment`, {
        method: 'PUT',
        body: JSON.stringify({ clientId: client.id, ownerCutPercent })
      });
      setSelectedDomainId('');
      setOwnerCutPercent('20');
      await Promise.all([load(), onChanged()]);
    } catch (assignmentError) {
      setError(assignmentError.message || 'Unable to assign subdomain');
    } finally {
      setBusy(false);
    }
  }

  async function removeDomain(domain) {
    setBusy(true);
    setError('');
    try {
      await api(`/api/admin/subdomains/${domain.id}/assignment`, {
        method: 'PUT',
        body: JSON.stringify({ clientId: null })
      });
      await Promise.all([load(), onChanged()]);
    } catch (assignmentError) {
      setError(assignmentError.message || 'Unable to remove subdomain');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="confirm-panel" role="dialog" aria-modal="true" aria-label="Manage client subdomains">
      <div className="confirm-box assignment-box">
        <div className="panel-heading">
          <div>
            <h2>{client.name} domains</h2>
            <p>Assigned clients see all stored synced data for each subdomain.</p>
          </div>
          <button className="icon-button" type="button" title="Close" onClick={onCancel} disabled={busy}>x</button>
        </div>
        <form className="assignment-form" onSubmit={addDomain}>
          <label>
            Available subdomain
            <select value={selectedDomainId} onChange={(event) => setSelectedDomainId(event.target.value)} disabled={busy || !data.available.length}>
              <option value="">{data.available.length ? 'Choose a subdomain' : 'No unassigned subdomains'}</option>
              {data.available.map((domain) => (
                <option value={domain.id} key={domain.id}>{domain.domain}</option>
              ))}
            </select>
          </label>
          <label>
            Your cut (%)
            <input
              type="number"
              min="0"
              max="100"
              step="0.01"
              value={ownerCutPercent}
              onChange={(event) => setOwnerCutPercent(event.target.value)}
              disabled={busy}
            />
          </label>
          <button className="secondary-button" type="submit" disabled={!selectedDomainId || busy}>
            <Plus size={15} />
            Add Domain
          </button>
        </form>
        <div className="assignment-list">
          {data.assigned.map((domain) => (
            <div className="assignment-row" key={domain.id}>
              <div>
                <strong>{domain.domain}</strong>
                <span>Your cut {number(domain.ownerCutPercent)}%</span>
              </div>
              <button className="row-action danger" type="button" title="Remove from client" onClick={() => removeDomain(domain)} disabled={busy}>
                <Trash2 size={15} />
              </button>
            </div>
          ))}
          {!data.assigned.length ? <p className="empty-assignment">No subdomains assigned.</p> : null}
        </div>
        {error ? <p className="form-error">{error}</p> : null}
      </div>
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

function EditDomainDialog({ row, clients, onCancel, onSave }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [assignmentHistory, setAssignmentHistory] = useState([]);
  const [values, setValues] = useState(() => ({
    domain: row.domain || '',
    category: row.category || 'Content',
    unitPrice: String(row.unitPrice ?? ''),
    rentStatus: row.rentStatus || 'active',
    notes: row.notes || '',
    clientId: row.clientId ? String(row.clientId) : '',
    ownerCutPercent: String(row.ownerCutPercent ?? 20)
  }));

  useEffect(() => {
    let cancelled = false;
    api(`/api/admin/subdomains/${row.id}/assignment-history`)
      .then((result) => {
        if (!cancelled) setAssignmentHistory(result.assignments || []);
      })
      .catch(() => {
        if (!cancelled) setAssignmentHistory([]);
      });
    return () => {
      cancelled = true;
    };
  }, [row.id]);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await onSave(values);
    } catch (saveError) {
      setError(saveError.message || 'Update failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="confirm-panel" role="dialog" aria-modal="true" aria-label="Edit domain">
      <form className="confirm-box edit-box" onSubmit={submit}>
        <h2>Edit Domain</h2>
        <div className="edit-form">
          <label>
            Domain
            <input value={values.domain} onChange={setField(setValues, 'domain')} required />
          </label>
          <label>
            Status
            <select value={values.rentStatus} onChange={setField(setValues, 'rentStatus')}>
              <option value="active">active</option>
              <option value="paused">paused</option>
              <option value="ended">ended</option>
            </select>
          </label>
          <label>
            Client
            <select value={values.clientId} onChange={setField(setValues, 'clientId')}>
              <option value="">Unassigned</option>
              {clients.map((client) => (
                <option value={client.id} key={client.id}>{client.name}</option>
              ))}
            </select>
          </label>
          <label>
            Your cut (%)
            <input
              type="number"
              min="0"
              max="100"
              step="0.01"
              value={values.ownerCutPercent}
              onChange={setField(setValues, 'ownerCutPercent')}
              disabled={!values.clientId}
            />
          </label>
          <label>
            Notes
            <input value={values.notes} onChange={setField(setValues, 'notes')} />
          </label>
        </div>
        {assignmentHistory.length ? (
          <div className="assignment-history" aria-label="Assignment history">
            {assignmentHistory.map((assignment) => (
              <div key={assignment.id}>
                <strong>{assignment.clientName}</strong>
                <span>{assignment.endedAt ? 'Previous' : 'Current'} - cut {number(assignment.ownerCutPercent)}%</span>
              </div>
            ))}
          </div>
        ) : null}
        {error ? <p className="form-error">{error}</p> : null}
        <div className="confirm-actions">
          <button className="ghost-button" type="button" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button className="primary-button" type="submit" disabled={busy}>
            Save
          </button>
        </div>
      </form>
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

function Controls({ range, effectiveRange, setRange, onRefresh, onColumns, refreshLabel = 'Refresh', refreshDisabled = false, children }) {
  function updateFrom(from) {
    setRange((current) => {
      const to = from && current.to && from > current.to ? from : current.to;
      return { from, to, preset: 'Custom' };
    });
  }

  function updateTo(to) {
    setRange((current) => {
      const from = to && current.from && to < current.from ? to : current.from;
      return { from, to, preset: 'Custom' };
    });
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
      <span className="range-chip">{rangeLabel(effectiveRange || range)}</span>
      <div className="control-spacer" />
      {children}
      <button className="ghost-button" type="button" onClick={onRefresh} disabled={refreshDisabled}>
        <RefreshCcw size={15} />
        {refreshLabel}
      </button>
      <button className="ghost-button desktop-only" type="button" onClick={onColumns}>
        Columns
        <ChevronDown size={15} />
      </button>
    </div>
  );
}

function ClientFreshness({ syncSummary = {}, lastLoadedAt }) {
  const latestLabel = syncSummary.latestMetricDate
    ? `Data through ${syncSummary.latestMetricDate}`
    : 'Waiting for synced data';
  const loadedLabel = lastLoadedAt ? `checked ${formatTime(lastLoadedAt)}` : 'checking now';
  return (
    <span className="auto-sync-note">
      Auto updates - {latestLabel} - {loadedLabel}
    </span>
  );
}

function MetricStrip({ totals = {}, clientMode = false }) {
  const stats = [
    { label: clientMode ? 'Your Earnings' : 'Gross Revenue', value: money(totals.earnings), icon: CircleDollarSign },
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

function DomainTable({ rows, totals = {}, loading, clientMode, compact, onView, onEdit, onDelete }) {
  const colSpan = clientMode
    ? (compact ? 6 : 10)
    : (compact ? 9 : 12);
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
            {clientMode && !compact ? <th>Client Share</th> : null}
            <th>{clientMode ? 'Your Earnings' : 'Gross Revenue'}</th>
            {!clientMode ? <th>Client Net</th> : null}
            {!clientMode ? <th>Your Cut</th> : null}
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
              {clientMode && !compact ? <td>{number(row.clientSharePercent)}%</td> : null}
              <td className="money">{money(row.earnings)}</td>
              {!clientMode ? <td className="money">{money(row.clientEarnings)}</td> : null}
              {!clientMode ? <td>{money(row.ownerCut)}</td> : null}
              {!compact ? <td><span className="source-pill">{row.source || 'empty'}</span></td> : null}
              <td>
                <div className="row-actions">
                  <button className="row-action" type="button" onClick={() => onView(row)} title="View">
                    <Eye size={15} />
                  </button>
                  {!clientMode && onEdit ? (
                    <button className="row-action" type="button" onClick={() => onEdit(row)} title="Edit subdomain">
                      <Pencil size={15} />
                    </button>
                  ) : null}
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
        {clientMode && !loading && rows.length ? (
          <tfoot>
            <tr>
              <td>Total</td>
              <td>{number(totals.pageViews)}</td>
              {!compact ? <td>{number(totals.impressions)}</td> : null}
              {!compact ? <td>{number(totals.clicks)}</td> : null}
              <td>{percent(totals.adxCtr)}</td>
              <td>{money(totals.adxEcpm)}</td>
              {!compact ? <td>-</td> : null}
              <td className="money">{money(totals.earnings)}</td>
              {!compact ? <td>-</td> : null}
              <td />
            </tr>
          </tfoot>
        ) : null}
      </table>
    </div>
  );
}

function DetailDrawer({ row, range, dailyPath, onClose }) {
  const [daily, setDaily] = useState([]);

  useEffect(() => {
    const path = dailyPath || `/api/client/subdomains/${row.id}/daily`;
    api(pathWithRange(path, range)).then((result) => setDaily(result.rows));
  }, [row.id, range, dailyPath]);

  return (
    <aside className="drawer">
      <button className="drawer-backdrop" type="button" onClick={onClose} aria-label="Close details" />
      <div className="drawer-panel">
        <div className="panel-heading">
          <div>
            <h2>{row.domain}</h2>
            <p>{rangeLabel(range)}</p>
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
              <em>{number(day.pageViews)} views - {percent(day.adxCtr)} CTR</em>
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
  return useState(() => ({ ...datePresets['All Time'](), preset: 'All Time' }));
}

function setField(setter, field) {
  return (event) => setter((current) => ({ ...current, [field]: event.target.value }));
}

function rangeQuery(range) {
  const params = new URLSearchParams();
  if (range?.from) params.set('from', range.from);
  if (range?.to) params.set('to', range.to);
  return params.toString();
}

function pathWithRange(path, range) {
  const query = rangeQuery(range);
  return query ? `${path}?${query}` : path;
}

function rangeLabel(range) {
  if (!range?.from && !range?.to) return 'All synced dates';
  if (range.from && range.to) return `${range.from} - ${range.to}`;
  return range.from ? `From ${range.from}` : `Until ${range.to}`;
}

function filterRows(rows, query) {
  const needle = String(query || '').trim().toLowerCase();
  if (!needle) return rows;
  return rows.filter((row) => [
    row.domain,
    row.clientName,
    row.category,
    row.rentStatus,
    row.source
  ].some((value) => String(value || '').toLowerCase().includes(needle)));
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

function formatDateTime(value) {
  if (!value) return 'Not finished';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(`${String(value).replace(' ', 'T')}Z`));
}

function formatTime(value) {
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).format(value instanceof Date ? value : new Date(value));
}

createRoot(document.getElementById('root')).render(<App />);
