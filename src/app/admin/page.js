'use client';
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';

export default function AdminPage() {
  const router = useRouter();
  const [token, setToken] = useState('');
  const [admin, setAdmin] = useState(null);
  const [users, setUsers] = useState([]);
  const [ips, setIps] = useState([]);
  const [zones, setZones] = useState([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');
  const [tab, setTab] = useState('users');

  // Add user form
  const [newEmail, setNewEmail] = useState('');
  const [newName, setNewName] = useState('');
  const [newRole, setNewRole] = useState('ch');
  const [newAccess, setNewAccess] = useState('city');
  const [newCities, setNewCities] = useState('');
  const [newZones, setNewZones] = useState('');
  const [newEndpoints, setNewEndpoints] = useState('funnel,finance,agent,hospital,agent-finance,hospital-finance');

  const headers = useCallback(() => ({ 'Content-Type': 'application/json', 'x-session-token': token }), [token]);

  useEffect(() => {
    const t = localStorage.getItem('dash_token');
    if (!t) { router.push('/login'); return; }
    setToken(t);
    fetch('/api/auth?token=' + t).then(r => r.json()).then(d => {
      if (!d.authenticated || d.user.role !== 'admin') { router.push('/'); return; }
      setAdmin(d.user);
    }).catch(() => router.push('/login'));
  }, [router]);

  const loadData = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const [uRes, iRes, zRes] = await Promise.all([
        fetch('/api/admin?action=users', { headers: { 'x-session-token': token } }),
        fetch('/api/admin?action=ips', { headers: { 'x-session-token': token } }),
        fetch('/api/admin?action=zones', { headers: { 'x-session-token': token } }),
      ]);
      const uData = await uRes.json();
      const iData = await iRes.json();
      const zData = await zRes.json();
      setUsers(uData.users || []);
      setIps(iData.ips || []);
      setZones(zData.zones || []);
    } catch (e) { setMsg('Error loading data: ' + e.message); }
    setLoading(false);
  }, [token]);

  useEffect(() => { if (token && admin) loadData(); }, [token, admin, loadData]);

  async function adminAction(action, body) {
    setMsg('');
    try {
      const res = await fetch('/api/admin', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ action, ...body }),
      });
      const data = await res.json();
      setMsg(data.message || data.error || 'Done');
      loadData();
    } catch (e) { setMsg('Error: ' + e.message); }
  }

  async function handleAddUser(e) {
    e.preventDefault();
    const body = {
      email: newEmail.trim().toLowerCase(),
      name: newName.trim(),
      role: newRole,
      accessLevel: newAccess,
      allowedCities: newCities ? newCities.split(',').map(c => c.trim().toUpperCase()) : null,
      allowedZones: newZones ? newZones.split(',').map(z => z.trim()) : null,
      allowedEndpoints: newEndpoints.split(',').map(e => e.trim()),
    };
    await adminAction('add-user', body);
    setNewEmail(''); setNewName('');
  }

  const ipsByUser = {};
  ips.forEach(ip => {
    if (!ipsByUser[ip.USER_EMAIL]) ipsByUser[ip.USER_EMAIL] = [];
    ipsByUser[ip.USER_EMAIL].push(ip);
  });

  const zoneGroups = {};
  zones.forEach(z => {
    if (!zoneGroups[z.ZONE_NAME]) zoneGroups[z.ZONE_NAME] = [];
    zoneGroups[z.ZONE_NAME].push(z.CITY_NAME);
  });

  if (!admin) return <div className="min-h-screen flex items-center justify-center"><p>Loading...</p></div>;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Admin Panel</h1>
          <p className="text-xs text-gray-500">{admin.email}</p>
        </div>
        <div className="flex gap-3">
          <button onClick={() => router.push('/')} className="px-4 py-2 text-sm bg-gray-100 rounded-lg hover:bg-gray-200">Dashboard</button>
          <button onClick={() => { localStorage.removeItem('dash_token'); router.push('/login'); }}
            className="px-4 py-2 text-sm bg-red-100 text-red-700 rounded-lg hover:bg-red-200">Logout</button>
        </div>
      </div>

      {/* Tabs */}
      <div className="px-6 pt-4 flex gap-2">
        {['users', 'ips', 'add-user', 'zones'].map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm rounded-lg font-medium ${tab === t ? 'bg-red-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-100'}`}>
            {t === 'add-user' ? 'Add User' : t === 'ips' ? 'IP Management' : t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {msg && <div className="mx-6 mt-4 p-3 bg-blue-50 border border-blue-200 text-blue-700 text-sm rounded-lg">{msg}</div>}

      <div className="p-6">
        {loading ? <p>Loading...</p> : (
          <>
            {/* USERS TAB */}
            {tab === 'users' && (
              <div className="bg-white rounded-xl border overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-gray-600 text-xs uppercase">
                    <tr>
                      <th className="px-4 py-3 text-left">Name</th>
                      <th className="px-4 py-3 text-left">Email</th>
                      <th className="px-4 py-3 text-left">Role</th>
                      <th className="px-4 py-3 text-left">Access</th>
                      <th className="px-4 py-3 text-left">Cities</th>
                      <th className="px-4 py-3 text-left">Status</th>
                      <th className="px-4 py-3 text-left">IPs</th>
                      <th className="px-4 py-3 text-left">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {users.map(u => {
                      const userIps = ipsByUser[u.EMAIL] || [];
                      const cities = u.ALLOWED_CITIES ? (typeof u.ALLOWED_CITIES === 'string' ? JSON.parse(u.ALLOWED_CITIES) : u.ALLOWED_CITIES) : null;
                      return (
                        <tr key={u.EMAIL} className={!u.IS_ACTIVE ? 'bg-red-50 opacity-60' : ''}>
                          <td className="px-4 py-3 font-medium">{u.NAME}</td>
                          <td className="px-4 py-3 text-gray-500">{u.EMAIL}</td>
                          <td className="px-4 py-3">
                            <span className={`px-2 py-0.5 rounded text-xs font-medium
                              ${u.ROLE === 'admin' ? 'bg-purple-100 text-purple-700' :
                                u.ROLE === 'zd' ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'}`}>
                              {u.ROLE.toUpperCase()}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-xs text-gray-500">{u.ACCESS_LEVEL}</td>
                          <td className="px-4 py-3 text-xs text-gray-500 max-w-[200px] truncate">
                            {cities ? cities.join(', ') : 'All'}
                          </td>
                          <td className="px-4 py-3">
                            <span className={`px-2 py-0.5 rounded text-xs ${u.IS_ACTIVE ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                              {u.IS_ACTIVE ? 'Active' : 'Disabled'}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <span className={`text-xs font-medium ${userIps.length >= 3 ? 'text-red-600' : 'text-gray-500'}`}>
                              {userIps.length}/3
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex gap-1">
                              <button onClick={() => adminAction('reset-ips', { email: u.EMAIL })}
                                className="px-2 py-1 text-xs bg-yellow-100 text-yellow-700 rounded hover:bg-yellow-200">Reset IPs</button>
                              <button onClick={() => adminAction('reset-password', { email: u.EMAIL })}
                                className="px-2 py-1 text-xs bg-blue-100 text-blue-700 rounded hover:bg-blue-200">Reset Pwd</button>
                              {u.IS_ACTIVE ?
                                <button onClick={() => adminAction('remove-user', { email: u.EMAIL })}
                                  className="px-2 py-1 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200">Disable</button> :
                                <button onClick={() => adminAction('activate-user', { email: u.EMAIL })}
                                  className="px-2 py-1 text-xs bg-green-100 text-green-700 rounded hover:bg-green-200">Enable</button>
                              }
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* IP MANAGEMENT TAB */}
            {tab === 'ips' && (
              <div className="space-y-4">
                {Object.entries(ipsByUser).map(([email, userIps]) => (
                  <div key={email} className="bg-white rounded-xl border p-4">
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <span className="font-medium text-sm">{email}</span>
                        <span className={`ml-2 px-2 py-0.5 rounded text-xs font-medium ${userIps.length >= 3 ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
                          {userIps.length}/3 IPs
                        </span>
                      </div>
                      <button onClick={() => adminAction('reset-ips', { email })}
                        className="px-3 py-1.5 text-xs bg-red-600 text-white rounded-lg hover:bg-red-700">
                        Reset All IPs
                      </button>
                    </div>
                    <div className="space-y-1">
                      {userIps.map((ip, i) => (
                        <div key={i} className="flex items-center justify-between text-xs bg-gray-50 rounded px-3 py-2">
                          <span className="font-mono">{ip.IP_ADDRESS}</span>
                          <span className="text-gray-400">First: {new Date(ip.FIRST_SEEN).toLocaleString()} | Last: {new Date(ip.LAST_SEEN).toLocaleString()}</span>
                        </div>
                      ))}
                      {userIps.length === 0 && <p className="text-xs text-gray-400">No IPs recorded yet</p>}
                    </div>
                  </div>
                ))}
                {Object.keys(ipsByUser).length === 0 && <p className="text-gray-500">No IP records yet</p>}
              </div>
            )}

            {/* ADD USER TAB */}
            {tab === 'add-user' && (
              <div className="bg-white rounded-xl border p-6 max-w-2xl">
                <h2 className="text-lg font-semibold mb-4">Add New User</h2>
                <form onSubmit={handleAddUser} className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Email</label>
                      <input value={newEmail} onChange={e => setNewEmail(e.target.value)} required
                        placeholder="user@red.health" className="w-full px-3 py-2 border rounded-lg text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Name</label>
                      <input value={newName} onChange={e => setNewName(e.target.value)} required
                        placeholder="Full Name" className="w-full px-3 py-2 border rounded-lg text-sm" />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Role</label>
                      <select value={newRole} onChange={e => setNewRole(e.target.value)}
                        className="w-full px-3 py-2 border rounded-lg text-sm">
                        <option value="admin">Admin (Full Access)</option>
                        <option value="zd">Zonal Director</option>
                        <option value="ch">City Head</option>
                        <option value="viewer">Viewer</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Access Level</label>
                      <select value={newAccess} onChange={e => setNewAccess(e.target.value)}
                        className="w-full px-3 py-2 border rounded-lg text-sm">
                        <option value="overall">Overall (All Cities)</option>
                        <option value="zone">Zone-based</option>
                        <option value="city">City-based</option>
                      </select>
                    </div>
                  </div>
                  {newAccess === 'zone' && (
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Zones (comma-separated)</label>
                      <input value={newZones} onChange={e => setNewZones(e.target.value)}
                        placeholder="North, South, East, West" className="w-full px-3 py-2 border rounded-lg text-sm" />
                      <p className="text-xs text-gray-400 mt-1">Available: {Object.keys(zoneGroups).join(', ')}</p>
                    </div>
                  )}
                  {newAccess === 'city' && (
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Cities (comma-separated codes)</label>
                      <input value={newCities} onChange={e => setNewCities(e.target.value)}
                        placeholder="DLH, BLR, MUM" className="w-full px-3 py-2 border rounded-lg text-sm" />
                    </div>
                  )}
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Allowed Endpoints</label>
                    <input value={newEndpoints} onChange={e => setNewEndpoints(e.target.value)}
                      className="w-full px-3 py-2 border rounded-lg text-sm" />
                    <p className="text-xs text-gray-400 mt-1">Options: funnel, finance, agent, hospital, agent-finance, hospital-finance</p>
                  </div>
                  <button type="submit" className="px-6 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700">
                    Add User
                  </button>
                  <p className="text-xs text-gray-400">User will set their password on first login.</p>
                </form>
              </div>
            )}

            {/* ZONES TAB */}
            {tab === 'zones' && (
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {Object.entries(zoneGroups).map(([zone, cities]) => (
                  <div key={zone} className="bg-white rounded-xl border p-4">
                    <h3 className="font-semibold text-sm mb-2">{zone} Zone</h3>
                    <p className="text-xs text-gray-500 mb-2">{cities.length} cities</p>
                    <div className="flex flex-wrap gap-1">
                      {cities.map(c => (
                        <span key={c} className="px-2 py-0.5 bg-gray-100 rounded text-xs">{c}</span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
