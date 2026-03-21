'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [setupEmail, setSetupEmail] = useState('');

  useEffect(() => {
    const token = localStorage.getItem('dash_token');
    if (token) {
      fetch('/api/auth?token=' + token)
        .then(r => r.json())
        .then(d => { if (d.authenticated) router.push('/'); })
        .catch(() => {});
    }
  }, [router]);

  async function handleLogin(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
      });
      const data = await res.json();
      if (data.needsPasswordSetup) {
        setNeedsSetup(true);
        setSetupEmail(data.email || email.trim().toLowerCase());
        setLoading(false);
        return;
      }
      if (!res.ok) {
        setError(data.error || 'Login failed');
        setLoading(false);
        return;
      }
      localStorage.setItem('dash_token', data.token);
      localStorage.setItem('dash_user', JSON.stringify(data.user));
      router.push('/');
    } catch (err) {
      setError('Network error. Please try again.');
    }
    setLoading(false);
  }

  async function handleSetPassword(e) {
    e.preventDefault();
    setError('');
    if (newPassword.length < 8) { setError('Password must be at least 8 characters'); return; }
    if (newPassword !== confirmPassword) { setError('Passwords do not match'); return; }
    setLoading(true);
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'set-password', email: setupEmail, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Failed to set password'); setLoading(false); return; }
      // Now login with the new password
      setNeedsSetup(false);
      setPassword(newPassword);
      const loginRes = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: setupEmail, password: newPassword }),
      });
      const loginData = await loginRes.json();
      if (loginData.token) {
        localStorage.setItem('dash_token', loginData.token);
        localStorage.setItem('dash_user', JSON.stringify(loginData.user));
        router.push('/');
      } else {
        setError('Password set. Please login again.');
        setNeedsSetup(false);
      }
    } catch (err) {
      setError('Network error');
    }
    setLoading(false);
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-red-50 via-white to-red-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-2xl shadow-xl border border-gray-100 p-8">
          {/* Logo / Header */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-red-600 rounded-2xl mb-4">
              <span className="text-white text-2xl font-bold">R</span>
            </div>
            <h1 className="text-2xl font-bold text-gray-900">RED.Health Dashboard</h1>
            <p className="text-sm text-gray-500 mt-1">
              {needsSetup ? 'Set your password to continue' : 'Sign in to access your dashboard'}
            </p>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-6 text-sm">
              {error}
            </div>
          )}

          {!needsSetup ? (
            <form onSubmit={handleLogin} className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="you@red.health"
                  required
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  required
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 text-sm"
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-red-600 text-white py-2.5 rounded-lg font-medium hover:bg-red-700 disabled:opacity-50 transition-colors"
              >
                {loading ? 'Signing in...' : 'Sign In'}
              </button>
            </form>
          ) : (
            <form onSubmit={handleSetPassword} className="space-y-5">
              <p className="text-sm text-gray-600 bg-yellow-50 border border-yellow-200 p-3 rounded-lg">
                First-time login for <strong>{setupEmail}</strong>. Please set your password.
              </p>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">New Password</label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  placeholder="Min 8 characters"
                  required
                  minLength={8}
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Confirm Password</label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter password"
                  required
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 text-sm"
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-red-600 text-white py-2.5 rounded-lg font-medium hover:bg-red-700 disabled:opacity-50 transition-colors"
              >
                {loading ? 'Setting password...' : 'Set Password & Login'}
              </button>
            </form>
          )}

          <div className="mt-6 pt-6 border-t border-gray-100 text-center">
            <p className="text-xs text-gray-400">Access restricted to authorized RED.Health personnel only</p>
            <p className="text-xs text-gray-400 mt-1">Max 3 devices per account</p>
          </div>
        </div>
      </div>
    </div>
  );
}
