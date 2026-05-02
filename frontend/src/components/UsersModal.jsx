import { useEffect, useState } from 'react'
import api from '../api'

const SECTIONS = [
  { key: 'devices', label: 'MAC Devices' },
  { key: 'iphosts', label: 'IP Hosts' },
  { key: 'fwusers', label: 'FW Users' },
]

const LEVELS = [
  { key: 'none', label: 'None' },
  { key: 'toggle', label: 'Toggle' },
  { key: 'full', label: 'Full' },
]

const DEFAULT_PERMS = { devices: 'none', iphosts: 'none', fwusers: 'none' }

function parsePerms(raw) {
  try { return { ...DEFAULT_PERMS, ...JSON.parse(raw || '{}') } } catch { return { ...DEFAULT_PERMS } }
}

function PermGrid({ perms, onChange }) {
  return (
    <div className="space-y-2">
      {SECTIONS.map(({ key, label }) => (
        <div key={key} className="flex items-center gap-2">
          <span className="text-xs text-gray-600 w-24 flex-shrink-0">{label}</span>
          <div className="flex gap-1">
            {LEVELS.map(({ key: lk, label: ll }) => (
              <button
                key={lk}
                type="button"
                onClick={() => onChange({ ...perms, [key]: lk })}
                className={`text-xs px-2.5 py-1 rounded-md font-medium border transition-all ${
                  perms[key] === lk
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'border-gray-300 text-gray-500 hover:border-blue-400 hover:text-blue-600'
                }`}
              >
                {ll}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function permsSummary(raw) {
  try {
    const p = JSON.parse(raw || '{}')
    const parts = SECTIONS
      .map(({ key, label }) => p[key] && p[key] !== 'none' ? `${label}: ${p[key]}` : null)
      .filter(Boolean)
    return parts.length ? parts.join(' · ') : 'No access'
  } catch { return 'No access' }
}

function UserRow({ u, isSuperAdmin, onDelete, onResetPassword, onUpdate }) {
  const [panel, setPanel] = useState(null)
  const [newPassword, setNewPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [editRole, setEditRole] = useState(u.role === 'admin' || u.role === 'superadmin' ? u.role : 'user')
  const [editPerms, setEditPerms] = useState(() => parsePerms(u.permissions))

  const closePanel = () => { setPanel(null); setMsg(''); setNewPassword('') }

  const handleReset = async (e) => {
    e.preventDefault()
    if (!newPassword.trim()) return
    setSaving(true)
    setMsg('')
    try {
      await onResetPassword(u.id, newPassword.trim())
      setMsg('Password updated')
      setNewPassword('')
      setTimeout(closePanel, 1500)
    } catch (err) {
      setMsg(err.response?.data?.detail || 'Failed')
    } finally {
      setSaving(false)
    }
  }

  const handleUpdate = async (e) => {
    e.preventDefault()
    setSaving(true)
    setMsg('')
    try {
      const role = editRole === 'admin' && isSuperAdmin ? 'admin' : 'user'
      const permissions = role === 'user' ? JSON.stringify(editPerms) : '{}'
      await onUpdate(u.id, { role, permissions })
      setMsg('Saved')
      setTimeout(closePanel, 1000)
    } catch (err) {
      setMsg(err.response?.data?.detail || 'Failed')
    } finally {
      setSaving(false)
    }
  }

  const roleBadge = u.role === 'superadmin'
    ? 'bg-purple-100 text-purple-700'
    : u.role === 'admin'
    ? 'bg-blue-100 text-blue-700'
    : 'bg-gray-100 text-gray-500'

  const roleLabel = u.role === 'superadmin' ? 'Superadmin' : u.role === 'admin' ? 'Admin' : 'User'

  return (
    <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
      <div className="flex items-center justify-between px-3 sm:px-4 py-3 gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-medium text-gray-800 truncate">{u.email}</p>
            <span className={`text-xs px-1.5 py-0.5 rounded font-medium flex-shrink-0 ${roleBadge}`}>
              {roleLabel}
            </span>
          </div>
          <p className="text-xs text-gray-400 mt-0.5">
            Added {new Date(u.created_at + 'Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            {u.role === 'user' && ` · ${permsSummary(u.permissions)}`}
          </p>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {u.role !== 'superadmin' && (
            <>
              <button
                onClick={() => {
                  setPanel(panel === 'edit' ? null : 'edit')
                  setMsg('')
                  setEditRole(u.role === 'admin' ? 'admin' : 'user')
                  setEditPerms(parsePerms(u.permissions))
                }}
                className="text-xs px-2.5 py-1.5 rounded-lg bg-gray-100 text-gray-500 hover:bg-blue-50 hover:text-blue-600 transition-colors font-medium"
              >
                {panel === 'edit' ? 'Cancel' : 'Edit'}
              </button>
              <button
                onClick={() => { setPanel(panel === 'password' ? null : 'password'); setMsg(''); setNewPassword('') }}
                className="text-xs px-2.5 py-1.5 rounded-lg bg-gray-100 text-gray-500 hover:bg-blue-50 hover:text-blue-600 transition-colors font-medium"
              >
                {panel === 'password' ? 'Cancel' : 'Reset PW'}
              </button>
              <button
                onClick={() => onDelete(u.id, u.email)}
                className="text-xs px-2.5 py-1.5 rounded-lg bg-gray-100 text-gray-500 hover:bg-red-50 hover:text-red-500 transition-colors font-medium"
              >
                Remove
              </button>
            </>
          )}
        </div>
      </div>

      {panel === 'edit' && (
        <form onSubmit={handleUpdate} className="border-t border-gray-100 px-3 sm:px-4 py-3 bg-gray-50 space-y-3">
          <p className="text-xs font-medium text-gray-600">Edit access for {u.email}</p>
          <select
            value={editRole}
            onChange={(e) => setEditRole(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          >
            <option value="user">User — custom permissions</option>
            {isSuperAdmin && <option value="admin">Admin — full access</option>}
          </select>
          {editRole === 'user' && (
            <div>
              <p className="text-xs font-medium text-gray-600 mb-2">Section Permissions</p>
              <PermGrid perms={editPerms} onChange={setEditPerms} />
            </div>
          )}
          {msg && <p className={`text-xs ${msg === 'Saved' ? 'text-green-600' : 'text-red-600'}`}>{msg}</p>}
          <button
            type="submit"
            disabled={saving}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </form>
      )}

      {panel === 'password' && (
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

export default function UsersModal({ onClose, isSuperAdmin }) {
  const [users, setUsers] = useState([])
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState('user')
  const [newPerms, setNewPerms] = useState({ ...DEFAULT_PERMS })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

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
      const permissions = role === 'user' ? JSON.stringify(newPerms) : '{}'
      const { data } = await api.post('/users', { email: email.trim(), password, role, permissions })
      setUsers((u) => [...u, data])
      setEmail('')
      setPassword('')
      setRole('user')
      setNewPerms({ ...DEFAULT_PERMS })
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

  const handleUpdate = async (id, data) => {
    const { data: updated } = await api.put(`/users/${id}`, data)
    setUsers((u) => u.map((x) => x.id === id ? updated : x))
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
              onChange={(e) => setRole(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            >
              <option value="user">User — custom permissions</option>
              {isSuperAdmin && <option value="admin">Admin — full access</option>}
            </select>
            {role === 'user' && (
              <div>
                <p className="text-xs font-medium text-gray-600 mb-2">Section Permissions</p>
                <PermGrid perms={newPerms} onChange={setNewPerms} />
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
                  isSuperAdmin={isSuperAdmin}
                  onDelete={handleDelete}
                  onResetPassword={handleResetPassword}
                  onUpdate={handleUpdate}
                />
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
