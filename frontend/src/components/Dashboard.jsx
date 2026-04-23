import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import api from '../api'
import DeviceCard from './DeviceCard'
import AddDeviceModal from './AddDeviceModal'
import EditDeviceModal from './EditDeviceModal'
import UsersModal from './UsersModal'

export default function Dashboard({ user, onLogout }) {
  const isAdmin = user.role === 'admin'
  const [devices, setDevices] = useState([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [showUsers, setShowUsers] = useState(false)
  const [editDevice, setEditDevice] = useState(null)
  const [search, setSearch] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)

  const fetchDevices = async () => {
    try {
      const { data } = await api.get('/devices')
      setDevices(data)
    } catch {
      toast.error('Failed to load devices')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchDevices() }, [])

  const extractError = (e, fallback) => {
    const detail = e.response?.data?.detail
    if (!detail) return fallback
    if (typeof detail === 'string') return detail
    if (Array.isArray(detail)) return detail.map((d) => d.msg || d.message || JSON.stringify(d)).join('; ')
    return fallback
  }

  const handleAdd = async (form) => {
    try {
      const { data } = await api.post('/devices', form)
      setDevices((d) => [data, ...d])
      toast.success(`${data.name} added to Sophos`)
      return null
    } catch (e) {
      const msg = extractError(e, 'Failed to add device')
      toast.error(msg)
      return msg
    }
  }

  const handleToggle = async (id) => {
    const device = devices.find((d) => d.id === id)
    const newState = !device.is_enabled
    // Flip instantly in UI, sync with server in background
    setDevices((ds) => ds.map((d) => d.id === id ? { ...d, is_enabled: newState } : d))
    try {
      const { data } = await api.patch(`/devices/${id}/toggle`)
      setDevices((ds) => ds.map((d) => d.id === id ? data : d))
      toast.success(data.is_enabled ? `${device.name}: Internet ON` : `${device.name}: Internet OFF`)
    } catch (e) {
      // Revert on failure
      setDevices((ds) => ds.map((d) => d.id === id ? device : d))
      toast.error(extractError(e, 'Toggle failed'))
    }
  }

  const handleEdit = async (id, form) => {
    try {
      const { data } = await api.patch(`/devices/${id}`, form)
      setDevices((ds) => ds.map((d) => d.id === id ? data : d))
      toast.success(`${data.name} updated in Sophos`)
      return null
    } catch (e) {
      const msg = extractError(e, 'Failed to update device')
      toast.error(msg)
      return msg
    }
  }

  const handleDelete = async (id) => {
    const device = devices.find((d) => d.id === id)
    // Remove instantly from UI, sync with server in background
    setDevices((ds) => ds.filter((d) => d.id !== id))
    try {
      await api.delete(`/devices/${id}`)
      toast.success(`${device.name} removed`)
    } catch (e) {
      // Revert on failure
      setDevices((ds) => [device, ...ds])
      toast.error(extractError(e, 'Delete failed'))
    }
  }

  const filtered = devices.filter((d) => {
    const q = search.toLowerCase()
    return (
      d.name.toLowerCase().includes(q) ||
      d.mac_address.toLowerCase().includes(q) ||
      d.description.toLowerCase().includes(q)
    )
  })

  const enabledCount = devices.filter((d) => d.is_enabled).length

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-20">
        <div className="max-w-6xl mx-auto px-4 h-14 sm:h-16 flex items-center justify-between gap-2">
          {/* Logo */}
          <div className="flex items-center gap-2 min-w-0">
            <img src="/heal-logo.png" alt="Heal" className="h-7 sm:h-8 object-contain flex-shrink-0" />
            <div className="min-w-0">
              <h1 className="font-bold text-gray-900 text-sm sm:text-base leading-none truncate">Heal School</h1>
              <p className="text-xs text-gray-400 leading-none mt-0.5 hidden sm:block">Private Network Control</p>
            </div>
          </div>

          {/* Desktop nav */}
          <div className="hidden sm:flex items-center gap-2">
            {isAdmin && (
              <button
                onClick={() => setShowUsers(true)}
                className="text-sm text-gray-500 hover:text-gray-900 border border-gray-200 px-3 py-1.5 rounded-lg hover:bg-gray-50 transition-colors whitespace-nowrap"
              >
                Manage Users
              </button>
            )}
            <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-white text-sm font-semibold flex-shrink-0">
              {user.name?.[0]?.toUpperCase() || user.email?.[0]?.toUpperCase() || '?'}
            </div>
            <div className="hidden md:block text-right">
              <p className="text-sm font-medium text-gray-800 leading-none">{user.name}</p>
              <p className="text-xs text-gray-400 leading-none mt-0.5">{user.email}</p>
            </div>
            <button
              onClick={onLogout}
              className="text-sm text-gray-500 hover:text-gray-900 border border-gray-200 px-3 py-1.5 rounded-lg hover:bg-gray-50 transition-colors"
            >
              Logout
            </button>
          </div>

          {/* Mobile menu button */}
          <button
            onClick={() => setMenuOpen((o) => !o)}
            className="sm:hidden p-2 rounded-lg text-gray-500 hover:bg-gray-100 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              {menuOpen
                ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                : <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />}
            </svg>
          </button>
        </div>

        {/* Mobile dropdown menu */}
        {menuOpen && (
          <div className="sm:hidden border-t border-gray-100 bg-white px-4 py-3 space-y-2">
            <div className="flex items-center gap-2 pb-2 border-b border-gray-100">
              <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-white text-sm font-semibold">
                {user.name?.[0]?.toUpperCase() || user.email?.[0]?.toUpperCase() || '?'}
              </div>
              <div>
                <p className="text-sm font-medium text-gray-800">{user.name}</p>
                <p className="text-xs text-gray-400">{user.email}</p>
              </div>
            </div>
            {isAdmin && (
              <button
                onClick={() => { setShowUsers(true); setMenuOpen(false) }}
                className="w-full text-left text-sm text-gray-700 py-2 px-1 hover:text-blue-600 transition-colors"
              >
                Manage Users
              </button>
            )}
            <button
              onClick={() => { onLogout(); setMenuOpen(false) }}
              className="w-full text-left text-sm text-red-500 py-2 px-1 hover:text-red-700 transition-colors"
            >
              Logout
            </button>
          </div>
        )}
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-4 sm:py-6">
        {/* Stats */}
        <div className="grid grid-cols-3 gap-2 sm:gap-4 mb-4 sm:mb-6">
          <div className="bg-white rounded-xl border border-gray-200 p-3 sm:p-4 text-center">
            <div className="text-xl sm:text-2xl font-bold text-gray-900">{devices.length}</div>
            <div className="text-xs sm:text-sm text-gray-500 mt-0.5">Total</div>
          </div>
          <div className="bg-green-50 rounded-xl border border-green-200 p-3 sm:p-4 text-center">
            <div className="text-xl sm:text-2xl font-bold text-green-700">{enabledCount}</div>
            <div className="text-xs sm:text-sm text-green-600 mt-0.5">Online</div>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-3 sm:p-4 text-center">
            <div className="text-xl sm:text-2xl font-bold text-gray-500">{devices.length - enabledCount}</div>
            <div className="text-xs sm:text-sm text-gray-500 mt-0.5">Offline</div>
          </div>
        </div>

        {/* Toolbar */}
        <div className="flex gap-2 mb-4 sm:mb-5">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search devices..."
            className="flex-1 border border-gray-300 rounded-lg px-3 sm:px-4 py-2 sm:py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
          />
          {isAdmin && (
            <button
              onClick={() => setShowAdd(true)}
              className="bg-blue-600 hover:bg-blue-700 text-white px-3 sm:px-5 py-2 sm:py-2.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-1 sm:gap-2 whitespace-nowrap"
            >
              <span className="text-lg leading-none">+</span>
              <span className="hidden xs:inline sm:inline">Add Device</span>
            </button>
          )}
        </div>

        {/* Device Grid */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="animate-spin h-8 w-8 border-4 border-blue-600 border-t-transparent rounded-full" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20">
            {devices.length === 0 ? (
              <>
                <div className="text-5xl mb-3">📡</div>
                <h3 className="text-lg font-semibold text-gray-700">No devices yet</h3>
                <p className="text-gray-400 mt-1 text-sm">
                  {isAdmin ? 'Add a MAC address to get started.' : 'No devices have been added yet.'}
                </p>
                {isAdmin && (
                  <button
                    onClick={() => setShowAdd(true)}
                    className="mt-4 bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-lg text-sm font-medium transition-colors"
                  >
                    Add First Device
                  </button>
                )}
              </>
            ) : (
              <>
                <div className="text-4xl mb-2">🔍</div>
                <p className="text-gray-500">No devices match your search.</p>
              </>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
            {filtered.map((device) => (
              <DeviceCard
                key={device.id}
                device={device}
                onToggle={handleToggle}
                onEdit={setEditDevice}
                onDelete={handleDelete}
                isAdmin={isAdmin}
              />
            ))}
          </div>
        )}
      </main>

      {showAdd && <AddDeviceModal onAdd={handleAdd} onClose={() => setShowAdd(false)} />}
      {showUsers && <UsersModal onClose={() => setShowUsers(false)} />}
      {editDevice && (
        <EditDeviceModal
          device={editDevice}
          onSave={handleEdit}
          onClose={() => setEditDevice(null)}
        />
      )}
    </div>
  )
}
