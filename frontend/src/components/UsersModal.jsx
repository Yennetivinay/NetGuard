import { useEffect, useState } from 'react'
import api from '../api'

function UserRow({ u, onDelete, onResetPassword }) {
  const [resetting, setResetting] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  const handleReset = async (e) => {
    e.preventDefault()
    if (!newPassword.trim()) return
    setSaving(true)
    setMsg('')
    try {
      await onResetPassword(u.id, newPassword.trim())
      setMsg('Password updated')
      setNewPassword('')
      setTimeout(() => { setResetting(false); setMsg('') }, 1500)
    } catch (err) {
      setMsg(err.response?.data?.detail || 'Failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
      {/* User info row */}
      <div className="flex items-center justify-between px-3 sm:px-4 py-3 gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-medium text-gray-800 truncate">{u.email}</p>
            <span className={`text-xs px-1.5 py-0.5 rounded font-medium flex-shrink-0 ${
              u.role === 'admin' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'
            }`}>
              {u.role === 'admin' ? 'Admin' : 'User'}
            </span>
          </div>
          <p className="text-xs text-gray-400 mt-0.5">
            Added {new Date(u.created_at + 'Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            {u.role !== 'admin' && (() => {
              try {
                const gs = JSON.parse(u.groups || '[]')
                return gs.length > 0 ? ` · ${gs.join(', ')}` : ' · No groups'
              } catch { return '' }
            })()}
          </p>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <button
            onClick={() => { setResetting((r) => !r); setMsg(''); setNewPassword('') }}
            className="text-xs px-2.5 py-1.5 rounded-lg bg-gray-100 text-gray-500 hover:bg-blue-50 hover:text-blue-600 transition-colors font-medium"
          >
            {resetting ? 'Cancel' : 'Reset PW'}
          </button>
          <button
            onClick={() => onDelete(u.id, u.email)}
            className="text-xs px-2.5 py-1.5 rounded-lg bg-gray-100 text-gray-500 hover:bg-red-50 hover:text-red-500 transition-colors font-medium"
          >
            Remove
          </button>
        </div>
      </div>

      {/* Inline reset form */}
      {resetting && (
        <form onSubmit={handleReset} className="border-t border-gray-100 px-3 sm:px-4 py-3 bg-gray-50">
          <p className="text-xs font-medium text-gray-600 mb-2">Set new password for {u.email}</p>
          <div className="flex gap-2">
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="New password"
              autoFocus
              className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-0"
            />
            <button
              type="submit"
              disabled={saving || !newPassword.trim()}
              className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 flex-shrink-0"
            >
              {saving ? '...' : 'Save'}
            </button>
          </div>
          {msg && (
            <p className={`text-xs mt-1.5 ${msg === 'Password updated' ? 'text-green-600' : 'text-red-600'}`}>
              {msg}
            </p>
          )}
        </form>
      )}
    </div>
  )
}

const GROUPS = ['School', 'Campus']

export default function UsersModal({ onClose }) {
  const [users, setUsers] = useState([])
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState('user')
  const [selectedGroups, setSelectedGroups] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const toggleGroup = (g) =>
    setSelectedGroups((prev) => prev.includes(g) ? prev.filter((x) => x !== g) : [...prev, g])

  const fetchUsers = async () => {
    try {
      const { data } = await api.get('/users')
      setUsers(data)
    } catch {
      setError('Failed to load users')
    }
  }

  useEffect(() => { fetchUsers() }, [])

  const handleAdd = async (e) => {
    e.preventDefault()
    setError('')
    if (!email.trim() || !password.trim()) { setError('Email and password are required.'); return }
    setLoading(true)
    try {
      const groups = role === 'admin' ? GROUPS : selectedGroups
      const { data } = await api.post('/users', { email: email.trim(), password, role, groups })
      setUsers((u) => [...u, data])
      setEmail('')
      setPassword('')
      setRole('user')
      setSelectedGroups([])
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to create user')
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async (id, userEmail) => {
    if (!window.confirm(`Remove access for ${userEmail}?`)) return
    try {
      await api.delete(`/users/${id}`)
      setUsers((u) => u.filter((x) => x.id !== id))
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to delete user')
    }
  }

  const handleResetPassword = async (id, newPassword) => {
    await api.patch(`/users/${id}/password`, { password: newPassword })
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4" onClick={onClose}>
      <div
        className="bg-white w-full sm:rounded-2xl sm:max-w-lg rounded-t-2xl shadow-2xl max-h-[92vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-center pt-3 pb-1 sm:hidden">
          <div className="w-10 h-1 bg-gray-300 rounded-full" />
        </div>

        <div className="px-5 pb-6 pt-2 sm:p-6">
          <div className="flex items-center justify-between mb-4 sm:mb-5">
            <h2 className="text-lg sm:text-xl font-bold text-gray-900">Manage Users</h2>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none p-1">&times;</button>
          </div>

          {/* Add user form */}
          <form onSubmit={handleAdd} className="bg-gray-50 rounded-xl p-4 mb-5 space-y-3">
            <p className="text-sm font-medium text-gray-700">Add New User</p>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email address"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <select
              value={role}
              onChange={(e) => { setRole(e.target.value); setSelectedGroups([]) }}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            >
              <option value="user">Normal User — toggle only</option>
              <option value="admin">Admin — full access</option>
            </select>
            {role === 'user' && (
              <div>
                <p className="text-xs font-medium text-gray-600 mb-1.5">Device Group Access</p>
                <div className="flex gap-2">
                  {GROUPS.map((g) => (
                    <button
                      key={g}
                      type="button"
                      onClick={() => toggleGroup(g)}
                      className={`flex-1 py-2 text-sm font-medium rounded-lg border transition-all ${
                        selectedGroups.includes(g)
                          ? 'bg-blue-600 text-white border-blue-600'
                          : 'border-gray-300 text-gray-600 hover:border-blue-400'
                      }`}
                    >
                      {g}
                    </button>
                  ))}
                </div>
                {selectedGroups.length === 0 && (
                  <p className="text-xs text-amber-600 mt-1">No group selected — user will see no devices.</p>
                )}
              </div>
            )}
            {error && <p className="text-red-600 text-sm">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
            >
              {loading ? 'Adding...' : 'Add User'}
            </button>
          </form>

          {/* User list */}
          <div className="space-y-2">
            {users.length === 0 ? (
              <p className="text-center text-gray-400 text-sm py-4">No users yet.</p>
            ) : (
              users.map((u) => (
                <UserRow
                  key={u.id}
                  u={u}
                  onDelete={handleDelete}
                  onResetPassword={handleResetPassword}
                />
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
