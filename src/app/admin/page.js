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
  const [newEndpoints, setNewEndpoints] = useState('funnel,finance,agent,hospital,agent-finance,hospital-finance,collections');


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

