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
  const [newEndpoints, setNewEndpoints] = useState('funnel,finance,agent,hospital,agent-finance,hospital-finance,finance-analytics-funnel,finance-analytics-finance,coll-lob,coll-summary,coll-hospital,coll-partner,coll-employee,coll-trend,coll-ageing,coll-b2h,coll-raw,business-projection');
  const [newLobs, setNewLobs] = useState('');

  // Edit user state
  const [editEmail, setEditEmail] = useState(null);
  const [editRole, setEditRole] = useState('');
  const [editAccess, setEditAccess] = useState('');
  const [editCities, setEditCities] = useState('');
  const [editZones, setEditZones] = useState('');
  const [editDashboard, setEditDashboard] = useState(true);
  const [editCollections, setEditCollections] = useState(true);
  const [editBusinessProjection, setEditBusinessProjection] = useState(false);
  const [editLobs, setEditLobs] = useState([]);

  const DASHBOARD_ENDPOINTS = ['funnel','finance','agent','hospital','agent-finance','hospital-finance','finance-analytics-funnel','finance-analytics-finance'];
  const COLLECTION_ENDPOINTS = ['coll-lob','coll-summary','coll-hospital','coll-partner','coll-employee','coll-trend','coll-ageing','coll-b2h','coll-raw'];
  const BUSINESS_PROJECTION_ENDPOINTS = ['business-projection'];
  const ALL_LOBS = ['Hospital', 'Stan Command', 'Digital'];

  function startEdit(u) {
    const eps = u.ALLOWED_ENDPOINTS ? (typeof u.ALLOWED_ENDPOINTS === 'string' ? JSON.parse(u.ALLOWED_ENDPOINTS) : u.ALLOWED_ENDPOINTS) : [];
    const lobs = u.ALLOWED_LOBS ? (typeof u.ALLOWED_LOBS === 'string' ? JSON.parse(u.ALLOWED_LOBS) : u.ALLOWED_LOBS) : [];
    const cities = u.ALLOWED_CITIES ? (typeof u.ALLOWED_CITIES === 'string' ? JSON.parse(u.ALLOWED_CITIES) : u.ALLOWED_CITIES) : null;
    const zones = u.ALLOWED_ZONES ? (typeof u.ALLOWED_ZONES === 'string' ? JSON.parse(u.ALLOWED_ZONES) : u.ALLOWED_ZONES) : null;
    setEditEmail(u.EMAIL);
    setEditRole(u.ROLE);
    setEditAccess(u.ACCESS_LEVEL);
    setEditCities(cities ? cities.join(', ') : '');
    setEditZones(zones ? zones.join(', ') : '');
    setEditDashboard(DASHBOARD_ENDPOINTS.some(e => eps.includes(e)));
    setEditCollections(COLLECTION_ENDPOINTS.some(e => eps.includes(e)));
    setEditBusinessProjection(BUSINESS_PROJECTION_ENDPOINTS.some(e => eps.includes(e)));
    setEditLobs(lobs.length > 0 ? [...lobs] : []);
  }

  async function saveEdit() {
    const endpoints = [
      ...(editDashboard ? DASHBOARD_ENDPOINTS : []),
      ...(editCollections ? COLLECTION_ENDPOINTS : []),
      ...(editBusinessProjection ? BUSINESS_PROJECTION_ENDPOINTS : []),
    ];
    const body = {
      email: editEmail,
      role: editRole,
      accessLevel: editAccess,
      allowedCities: editCities ? editCities.split(',').map(c => c.trim().toUpperCase()) : null,
      allowedZones: editZones ? editZones.split(',').map(z => z.trim()) : null,
      allowedEndpoints: endpoints,
      allowedLobs: editLobs.length > 0 ? editLobs : null,
    };
    await adminAction('update-access', body);
    setEditEmail(null);
  }

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
      allowedLobs: newLobs ? newLobs.split(',').map(l => l.trim()) : null,
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
                      <th className="px-3 py-3 text-left">Name</th>
                      <th className="px-3 py-3 text-left">Email</th>
                      <th className="px-3 py-3 text-left">Role</th>
                      <th className="px-3 py-3 text-left">Access</th>
                      <th className="px-3 py-3 text-left">Cities</th>
                      <th className="px-3 py-3 text-left">LOBs</th>
                      <th className="px-3 py-3 text-left">Modules</th>
                      <th className="px-3 py-3 text-left">Status</th>
                      <th className="px-3 py-3 text-left">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {users.map(u => {
                      const userIps = ipsByUser[u.EMAIL] || [];
                      const cities = u.ALLOWED_CITIES ? (typeof u.ALLOWED_CITIES === 'string' ? JSON.parse(u.ALLOWED_CITIES) : u.ALLOWED_CITIES) : null;
                      const eps = u.ALLOWED_ENDPOINTS ? (typeof u.ALLOWED_ENDPOINTS === 'string' ? JSON.parse(u.ALLOWED_ENDPOINTS) : u.ALLOWED_ENDPOINTS) : [];
                      const lobs = u.ALLOWED_LOBS ? (typeof u.ALLOWED_LOBS === 'string' ? JSON.parse(u.ALLOWED_LOBS) : u.ALLOWED_LOBS) : [];
                      const hasDash = DASHBOARD_ENDPOINTS.some(e => eps.includes(e));
                      const hasColl = COLLECTION_ENDPOINTS.some(e => eps.includes(e));
                      const hasBizP = BUSINESS_PROJECTION_ENDPOINTS.some(e => eps.includes(e));
                      const isEditing = editEmail === u.EMAIL;
                      return (
                        <tr key={u.EMAIL} className={`${!u.IS_ACTIVE ? 'bg-red-50 opacity-60' : ''} ${isEditing ? 'bg-blue-50' : ''}`}>
                          {isEditing ? (
                            <td colSpan={9} className="px-3 py-4">
                              <div className="space-y-3">
                                <div className="flex items-center gap-2 mb-2">
                                  <span className="font-semibold text-sm">{u.NAME}</span>
                                  <span className="text-gray-400 text-xs">{u.EMAIL}</span>
                                </div>
                                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                                  <div>
                                    <label className="block text-xs font-medium text-gray-500 mb-1">Role</label>
                                    <select value={editRole} onChange={e => setEditRole(e.target.value)}
                                      className="w-full px-2 py-1.5 border rounded text-sm">
                                      <option value="admin">Admin</option>
                                      <option value="zd">Zonal Director</option>
                                      <option value="ch">City Head</option>
                                      <option value="viewer">Viewer</option>
                                    </select>
                                  </div>
                                  <div>
                                    <label className="block text-xs font-medium text-gray-500 mb-1">Access Level</label>
                                    <select value={editAccess} onChange={e => setEditAccess(e.target.value)}
                                      className="w-full px-2 py-1.5 border rounded text-sm">
                                      <option value="overall">Overall (All)</option>
                                      <option value="zone">Zone-based</option>
                                      <option value="city">City-based</option>
                                    </select>
                                  </div>
                                  {editAccess === 'zone' && (
                                    <div>
                                      <label className="block text-xs font-medium text-gray-500 mb-1">Zones</label>
                                      <input value={editZones} onChange={e => setEditZones(e.target.value)}
                                        placeholder="North, South" className="w-full px-2 py-1.5 border rounded text-sm" />
                                    </div>
                                  )}
                                  {editAccess === 'city' && (
                                    <div>
                                      <label className="block text-xs font-medium text-gray-500 mb-1">Cities</label>
                                      <input value={editCities} onChange={e => setEditCities(e.target.value)}
                                        placeholder="DLH, BLR, MUM" className="w-full px-2 py-1.5 border rounded text-sm" />
                                    </div>
                                  )}
                                </div>
                                <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                                  <div>
                                    <label className="block text-xs font-medium text-gray-500 mb-1">Module Access</label>
                                    <div className="flex gap-3">
                                      <label className="flex items-center gap-1.5 text-sm">
                                        <input type="checkbox" checked={editDashboard} onChange={e => setEditDashboard(e.target.checked)}
                                          className="rounded border-gray-300" /> Dashboard
                                      </label>
                                      <label className="flex items-center gap-1.5 text-sm">
                                        <input type="checkbox" checked={editCollections} onChange={e => setEditCollections(e.target.checked)}
                                          className="rounded border-gray-300" /> Finance Analytics
                                      </label>
                                      <label className="flex items-center gap-1.5 text-sm">
                                        <input type="checkbox" checked={editBusinessProjection} onChange={e => setEditBusinessProjection(e.target.checked)}
                                          className="rounded border-gray-300" /> Business Projection
                                      </label>
                                    </div>
                                  </div>
                                  <div>
                                    <label className="block text-xs font-medium text-gray-500 mb-1">LOB Access (empty = All)</label>
                                    <div className="flex gap-3">
                                      {ALL_LOBS.map(lob => (
                                        <label key={lob} className="flex items-center gap-1.5 text-sm">
                                          <input type="checkbox" checked={editLobs.includes(lob)}
                                            onChange={e => setEditLobs(prev => e.target.checked ? [...prev, lob] : prev.filter(l => l !== lob))}
                                            className="rounded border-gray-300" /> {lob}
                                        </label>
                                      ))}
                                    </div>
                                  </div>
                                </div>
                                <div className="flex gap-2 pt-1">
                                  <button onClick={saveEdit}
                                    className="px-4 py-1.5 text-xs bg-green-600 text-white rounded-lg hover:bg-green-700 font-medium">Save</button>
                                  <button onClick={() => setEditEmail(null)}
                                    className="px-4 py-1.5 text-xs bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 font-medium">Cancel</button>
                                </div>
                              </div>
                            </td>
                          ) : (
                            <>
                              <td className="px-3 py-3 font-medium">{u.NAME}</td>
                              <td className="px-3 py-3 text-gray-500 text-xs">{u.EMAIL}</td>
                              <td className="px-3 py-3">
                                <span className={`px-2 py-0.5 rounded text-xs font-medium
                                  ${u.ROLE === 'admin' ? 'bg-purple-100 text-purple-700' :
                                    u.ROLE === 'zd' ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'}`}>
                                  {u.ROLE.toUpperCase()}
                                </span>
                              </td>
                              <td className="px-3 py-3 text-xs text-gray-500">{u.ACCESS_LEVEL}</td>
                              <td className="px-3 py-3 text-xs text-gray-500 max-w-[150px] truncate">
                                {cities ? cities.join(', ') : 'All'}
                              </td>
                              <td className="px-3 py-3 text-xs text-gray-500">
                                {lobs.length > 0 ? lobs.join(', ') : 'All'}
                              </td>
                              <td className="px-3 py-3">
                                <div className="flex gap-1">
                                  {hasDash && <span className="px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded text-[10px] font-medium">Dash</span>}
                                  {hasColl && <span className="px-1.5 py-0.5 bg-green-100 text-green-700 rounded text-[10px] font-medium">Fin</span>}
                                  {hasBizP && <span className="px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded text-[10px] font-medium">BizP</span>}
                                </div>
                              </td>
                              <td className="px-3 py-3">
                                <span className={`px-2 py-0.5 rounded text-xs ${u.IS_ACTIVE ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                                  {u.IS_ACTIVE ? 'Active' : 'Disabled'}
                                </span>
                              </td>
                              <td className="px-3 py-3">
                                <div className="flex gap-1">
                                  <button onClick={() => startEdit(u)}
                                    className="px-2 py-1 text-xs bg-indigo-100 text-indigo-700 rounded hover:bg-indigo-200">Edit</button>
                                  <button onClick={() => adminAction('reset-ips', { email: u.EMAIL })}
                                    className="px-2 py-1 text-xs bg-yellow-100 text-yellow-700 rounded hover:bg-yellow-200">IPs</button>
                                  <button onClick={() => adminAction('reset-password', { email: u.EMAIL })}
                                    className="px-2 py-1 text-xs bg-blue-100 text-blue-700 rounded hover:bg-blue-200">Pwd</button>
                                  {u.IS_ACTIVE ?
                                    <button onClick={() => adminAction('remove-user', { email: u.EMAIL })}
                                      className="px-2 py-1 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200">Off</button> :
                                    <button onClick={() => adminAction('activate-user', { email: u.EMAIL })}
                                      className="px-2 py-1 text-xs bg-green-100 text-green-700 rounded hover:bg-green-200">On</button>
                                  }
                                </div>
                              </td>
                            </>
                          )}
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
                    <label className="block text-xs font-medium text-gray-600 mb-1">LOB Access (empty = All LOBs)</label>
                    <input value={newLobs} onChange={e => setNewLobs(e.target.value)}
                      placeholder="Hospital, Stan Command, Digital" className="w-full px-3 py-2 border rounded-lg text-sm" />
                    <p className="text-xs text-gray-400 mt-1">Leave empty for all LOBs. Options: Hospital, Stan Command, Digital</p>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Allowed Endpoints</label>
                    <input value={newEndpoints} onChange={e => setNewEndpoints(e.target.value)}
                      className="w-full px-3 py-2 border rounded-lg text-sm" />
                    <p className="text-xs text-gray-400 mt-1">Dashboard + Finance Analytics + Business Projection endpoints (auto-filled for all access)</p>
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
