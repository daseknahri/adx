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
    <Shell user={user} onLogout={handleLogout}>
      {user.role === 'admin' ? <AdminConsole /> : <ClientDashboard />}
    </Shell>
  );
}

function Shell({ user, onLogout, children }) {
  return (
    <div className="app-shell">
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
          <button className="icon-button" type="button" title="Theme">
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
      <Controls range={range} setRange={setRange} onRefresh={load} />
      <MetricStrip totals={data.totals} />
      <DomainTable
        rows={data.rows}
        loading={loading}
        clientMode
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
  const [overview, setOverview] = useState({ rows: [], totals: {}, latestSync: [] });
  const [clients, setClients] = useState([]);
  const [google, setGoogle] = useState({});
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [selectedDomain, setSelectedDomain] = useState(null);

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

  return (
    <section className="workspace">
      <PageTitle title="Admin Console" subtitle="Clients, subdomains and AdX sync" />
      <Controls range={range} setRange={setRange} onRefresh={load}>
        <button className="primary-button" type="button" onClick={sync}>
          <DatabaseZap size={16} />
          Sync AdX
        </button>
      </Controls>
      <AdminStatus google={google} message={message} latestSync={overview.latestSync} />
      <MetricStrip totals={overview.totals} />
      <div className="admin-grid">
        <AdminForms clients={clients} onChanged={load} />
        <div className="panel table-panel">
          <div className="panel-heading">
            <div>
              <h2>Subdomains</h2>
              <p>{overview.rows.length} tracked rows</p>
            </div>
            <button className="ghost-button" type="button">
              Columns
              <ChevronDown size={15} />
            </button>
          </div>
          <DomainTable rows={overview.rows} loading={loading} onView={(row) => setSelectedDomain(row)} />
        </div>
      </div>
      {selectedDomain ? (
        <DetailDrawer
          row={selectedDomain}
          range={range}
          dailyPath={`/api/admin/subdomains/${selectedDomain.id}/daily`}
          onClose={() => setSelectedDomain(null)}
        />
      ) : null}
    </section>
  );
}

function AdminStatus({ google, message, latestSync }) {
  const latest = latestSync?.[0];
  return (
    <div className="status-rail">
      <div>
        <ShieldCheck size={18} />
        <span>Ad Manager</span>
        <strong>{google.connected ? 'Connected' : 'Not connected'}</strong>
        {google.hasClientConfig ? (
          <a className="inline-action" href="/api/admin/google/oauth/start">
            <PlugZap size={13} />
            {google.connected ? 'Reconnect' : 'Connect'}
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

  return (
    <div className="panel forms-panel">
      <div className="panel-heading">
        <div>
          <h2>Clients</h2>
          <p>Create access and assign domains</p>
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
      <form className="compact-form split" onSubmit={createSubdomain}>
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
      <div className="client-list">
        {clients.map((item) => (
          <div className="client-row" key={item.id}>
            <div>
              <strong>{item.name}</strong>
              <span>{item.email}</span>
            </div>
            <em className={item.status}>{item.status}</em>
            <span>{item.subdomainCount} domains</span>
            <button
              className="row-action"
              type="button"
              title={item.status === 'active' ? 'Pause client' : 'Activate client'}
              onClick={() => updateClientStatus(item, item.status === 'active' ? 'paused' : 'active')}
            >
              {item.status === 'active' ? <PauseCircle size={15} /> : <PlayCircle size={15} />}
            </button>
          </div>
        ))}
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

function Controls({ range, setRange, onRefresh, children }) {
  return (
    <div className="controls">
      <div className="date-input">
        <CalendarDays size={16} />
        <input type="date" value={range.from} onChange={(event) => setRange({ ...range, from: event.target.value })} />
        <span>-</span>
        <input type="date" value={range.to} onChange={(event) => setRange({ ...range, to: event.target.value })} />
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
      <button className="ghost-button desktop-only" type="button">
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

function DomainTable({ rows, loading, clientMode, onView }) {
  return (
    <div className="domain-table-wrap">
      <table className="domain-table">
        <thead>
          <tr>
            <th>Domain</th>
            {!clientMode ? <th>Client</th> : null}
            <th>Visitors</th>
            <th>Page Views</th>
            <th>AdX CTR</th>
            <th>AdX eCPM</th>
            <th>Category</th>
            <th>Unit Price</th>
            <th>Revenue</th>
            <th>Active Users</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr><td className="empty" colSpan={clientMode ? 10 : 11}>Loading...</td></tr>
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
              <td>{number(row.visitors)}</td>
              <td>{number(row.pageViews)}</td>
              <td>{percent(row.adxCtr)}</td>
              <td>{money(row.adxEcpm)}</td>
              <td>{row.category}</td>
              <td>{money(row.unitPrice)}</td>
              <td className="money">{money(row.earnings)}</td>
              <td>{number(row.activeUsers)}</td>
              <td>
                <button className="row-action" type="button" onClick={() => onView(row)} title="View">
                  <Eye size={15} />
                </button>
              </td>
            </tr>
          )) : (
            <tr><td className="empty" colSpan={clientMode ? 10 : 11}>No results.</td></tr>
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
  return date.toISOString().slice(0, 10);
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
