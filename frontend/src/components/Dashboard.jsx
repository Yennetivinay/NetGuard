import { useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import api from '../api'
import DeviceCard from './DeviceCard'
import AddDeviceModal from './AddDeviceModal'
import EditDeviceModal from './EditDeviceModal'
import UsersModal from './UsersModal'
import IPHostCard from './IPHostCard'
import AddIPHostModal from './AddIPHostModal'
import EditIPHostModal from './EditIPHostModal'
import FirewallUserCard from './FirewallUserCard'
import AddFirewallUserModal from './AddFirewallUserModal'
import EditFirewallUserModal from './EditFirewallUserModal'

export default function Dashboard({ user, onLogout }) {
  const isAdmin = user.role === 'admin'
  const [tab, setTab] = useState('devices')

  // ── MAC Devices ──────────────────────────────────────────────────────────────
  const [devices, setDevices] = useState([])
  const [loading, setLoading] = useState(true)
  const inFlightIds = useRef(new Set())
  const [showAdd, setShowAdd] = useState(false)
  const [editDevice, setEditDevice] = useState(null)
  const [search, setSearch] = useState('')

  // ── IP Hosts ─────────────────────────────────────────────────────────────────
  const [ipHosts, setIpHosts] = useState([])
  const [ipLoading, setIpLoading] = useState(true)
  const inFlightIpIds = useRef(new Set())
  const [showAddIP, setShowAddIP] = useState(false)
  const [editIPHost, setEditIPHost] = useState(null)
  const [ipSearch, setIpSearch] = useState('')

  // ── Firewall Users ────────────────────────────────────────────────────────────
  const [fwUsers, setFwUsers] = useState([])
  const [fwLoading, setFwLoading] = useState(true)
  const [showAddFW, setShowAddFW] = useState(false)
  const [editFWUser, setEditFWUser] = useState(null)
  const [fwSearch, setFwSearch] = useState('')

  // ── Shared ───────────────────────────────────────────────────────────────────
  const [showUsers, setShowUsers] = useState(false)
  const [showLogs, setShowLogs] = useState(false)
  const [logs, setLogs] = useState([])
  const [menuOpen, setMenuOpen] = useState(false)
  const [sophosConnected, setSophosConnected] = useState(true)

  const fetchDevices = async (silent = false) => {
    try {
      const { data } = await api.get('/devices')
      setDevices((prev) =>
        data.map((d) => inFlightIds.current.has(d.id) ? (prev.find((p) => p.id === d.id) || d) : d)
      )
    } catch {
      if (!silent) toast.error('Failed to load devices')
    } finally {
      if (!silent) setLoading(false)
    }
  }

  const fetchIPHosts = async (silent = false) => {
    if (!isAdmin) { setIpLoading(false); return }
    try {
      const { data } = await api.get('/ip-hosts')
      setIpHosts((prev) =>
        data.map((h) => inFlightIpIds.current.has(h.name) ? (prev.find((p) => p.name === h.name) || h) : h)
      )
    } catch {
      if (!silent) toast.error('Failed to load IP hosts')
    } finally {
      if (!silent) setIpLoading(false)
    }
  }

  const fetchFWUsers = async (silent = false) => {
    if (!isAdmin) { setFwLoading(false); return }
    try {
      const { data } = await api.get('/firewall-users')
      setFwUsers(data)
    } catch {
      if (!silent) toast.error('Failed to load firewall users')
    } finally {
      if (!silent) setFwLoading(false)
    }
  }

  const checkSophos = async () => {
    try {
      const { data } = await api.get('/sophos/status')
      setSophosConnected(data.connected)
    } catch {
      setSophosConnected(false)
    }
  }

  useEffect(() => {
    fetchDevices()
    fetchIPHosts()
    fetchFWUsers()
    checkSophos()
    const devicePoll = setInterval(() => fetchDevices(true), 5000)
    const ipPoll = setInterval(() => fetchIPHosts(true), 5000)
    const sophosPoll = setInterval(checkSophos, 30000)
    return () => {
      clearInterval(devicePoll)
      clearInterval(ipPoll)
      clearInterval(sophosPoll)
    }
  }, [])

  const extractError = (e, fallback) => {
    const detail = e.response?.data?.detail
    if (!detail) return fallback
    if (typeof detail === 'string') return detail
    if (Array.isArray(detail)) return detail.map((d) => d.msg || d.message || JSON.stringify(d)).join('; ')
    return fallback
  }

  // ── Device handlers ───────────────────────────────────────────────────────────
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
    inFlightIds.current.add(id)
    setDevices((ds) => ds.map((d) => d.id === id ? { ...d, is_enabled: newState } : d))
    try {
      const { data } = await api.patch(`/devices/${id}/toggle`)
      setDevices((ds) => ds.map((d) => d.id === id ? data : d))
      toast.success(data.is_enabled ? `${device.name}: Internet ON` : `${device.name}: Internet OFF`)
    } catch (e) {
      setDevices((ds) => ds.map((d) => d.id === id ? device : d))
      toast.error(extractError(e, 'Toggle failed'))
    } finally {
      inFlightIds.current.delete(id)
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
    setDevices((ds) => ds.filter((d) => d.id !== id))
    try {
      await api.delete(`/devices/${id}`)
      toast.success(`${device.name} removed`)
    } catch (e) {
      setDevices((ds) => [device, ...ds])
      toast.error(extractError(e, 'Delete failed'))
    }
  }

  // ── IP Host handlers ──────────────────────────────────────────────────────────
  const handleAddIP = async (form) => {
    try {
      const { data } = await api.post('/ip-hosts', form)
      setIpHosts((h) => [data, ...h])
      toast.success(`${data.name} added to Sophos`)
      return null
    } catch (e) {
      const msg = extractError(e, 'Failed to add IP host')
      toast.error(msg)
      return msg
    }
  }

  const handleToggleIP = async (name) => {
    const host = ipHosts.find((h) => h.name === name)
    const newState = !host.is_enabled
    inFlightIpIds.current.add(name)
    setIpHosts((hs) => hs.map((h) => h.name === name ? { ...h, is_enabled: newState } : h))
    try {
      const { data } = await api.patch(`/ip-hosts/${encodeURIComponent(name)}/toggle`)
      setIpHosts((hs) => hs.map((h) => h.name === name ? data : h))
      toast.success(data.is_enabled ? `${name}: Access ON` : `${name}: Access OFF`)
    } catch (e) {
      setIpHosts((hs) => hs.map((h) => h.name === name ? host : h))
      toast.error(extractError(e, 'Toggle failed'))
    } finally {
      inFlightIpIds.current.delete(name)
    }
  }

  const handleEditIP = async (name, form) => {
    try {
      const { data } = await api.patch(`/ip-hosts/${encodeURIComponent(name)}`, form)
      setIpHosts((hs) => hs.map((h) => h.name === name ? data : h))
      toast.success(`${data.name} updated in Sophos`)
      return null
    } catch (e) {
      const msg = extractError(e, 'Failed to update IP host')
      toast.error(msg)
      return msg
    }
  }

  const handleDeleteIP = async (name) => {
    const host = ipHosts.find((h) => h.name === name)
    setIpHosts((hs) => hs.filter((h) => h.name !== name))
    try {
      await api.delete(`/ip-hosts/${encodeURIComponent(name)}`)
      toast.success(`${name} removed`)
    } catch (e) {
      setIpHosts((hs) => [host, ...hs])
      toast.error(extractError(e, 'Delete failed'))
    }
  }

  // ── Firewall User handlers ────────────────────────────────────────────────────
  const handleAddFW = async (form) => {
    try {
      const { data } = await api.post('/firewall-users', form)
      setFwUsers((u) => [data, ...u])
      toast.success(`${data.username} added to firewall`)
      return null
    } catch (e) {
      const msg = extractError(e, 'Failed to add firewall user')
      toast.error(msg)
      return msg
    }
  }

  const handleToggleFW = async (username) => {
    try {
      const { data } = await api.patch(`/firewall-users/${username}/toggle`)
      setFwUsers((us) => us.map((u) => u.username === username ? data : u))
      toast.success(`${username}: ${data.status}`)
    } catch (e) {
      toast.error(extractError(e, 'Toggle failed'))
      fetchFWUsers(true)
    }
  }

  const handleEditFW = async (username, form) => {
    try {
      const { data } = await api.patch(`/firewall-users/${username}`, form)
      setFwUsers((us) => us.map((u) => u.username === username ? data : u))
      toast.success(`${username} updated`)
      return null
    } catch (e) {
      const msg = extractError(e, 'Failed to update firewall user')
      toast.error(msg)
      return msg
    }
  }

  const handleDeleteFW = async (username) => {
    const prev = fwUsers.find((u) => u.username === username)
    setFwUsers((us) => us.filter((u) => u.username !== username))
    try {
      await api.delete(`/firewall-users/${username}`)
      toast.success(`${username} removed from firewall`)
    } catch (e) {
      setFwUsers((us) => [prev, ...us])
      toast.error(extractError(e, 'Delete failed'))
    }
  }

  // ── Filtered lists ────────────────────────────────────────────────────────────
  const filteredDevices = devices.filter((d) => {
    const q = search.toLowerCase()
    return d.name.toLowerCase().includes(q) || d.mac_address.toLowerCase().includes(q) || d.description.toLowerCase().includes(q)
  })

  const filteredIPHosts = ipHosts.filter((h) => {
    const q = ipSearch.toLowerCase()
    return h.name.toLowerCase().includes(q) || h.ip_value.toLowerCase().includes(q) || h.description.toLowerCase().includes(q)
  })

  const filteredFWUsers = fwUsers.filter((u) => {
    const q = fwSearch.toLowerCase()
    return u.username.toLowerCase().includes(q) || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q) || u.group.toLowerCase().includes(q)
  })

  const enabledCount = devices.filter((d) => d.is_enabled).length
  const enabledIPCount = ipHosts.filter((h) => h.is_enabled).length
  const activeFWCount = fwUsers.filter((u) => u.status === 'Active').length

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-20">
        <div className="max-w-6xl mx-auto px-4 h-14 sm:h-16 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <img src="/heal-logo.png" alt="Heal" className="h-7 sm:h-8 object-contain flex-shrink-0" />
            <div className="min-w-0">
              <h1 className="font-bold text-gray-900 text-sm sm:text-base leading-none truncate">Heal School</h1>
              <p className="text-xs text-gray-400 leading-none mt-0.5 hidden sm:block">Private Network Control</p>
            </div>
          </div>

          <div className="hidden sm:flex items-center gap-2">
            {isAdmin && (
              <>
                <button
                  onClick={() => setShowUsers(true)}
                  className="text-sm text-gray-500 hover:text-gray-900 border border-gray-200 px-3 py-1.5 rounded-lg hover:bg-gray-50 transition-colors whitespace-nowrap"
                >
                  Manage Users
                </button>
                <button
                  onClick={async () => { const { data } = await api.get('/logs'); setLogs(data); setShowLogs(true) }}
                  className="text-sm text-gray-500 hover:text-gray-900 border border-gray-200 px-3 py-1.5 rounded-lg hover:bg-gray-50 transition-colors whitespace-nowrap"
                >
                  Activity Logs
                </button>
              </>
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

      {!sophosConnected && (
        <div className="bg-red-600 text-white text-sm px-4 py-2.5 flex items-center gap-2 justify-center">
          <span className="w-2 h-2 rounded-full bg-white animate-pulse flex-shrink-0" />
          Firewall is not connected — all operations are blocked.
        </div>
      )}

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-4 sm:py-6">

        {/* Tabs — extra tabs only shown to admins */}
        {isAdmin && (
          <div className="flex bg-gray-100 rounded-xl p-1 mb-5 w-fit">
            <button
              onClick={() => setTab('devices')}
              className={`px-4 py-2 text-sm font-medium rounded-lg transition-all ${
                tab === 'devices' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              MAC Devices
            </button>
            <button
              onClick={() => setTab('iphosts')}
              className={`px-4 py-2 text-sm font-medium rounded-lg transition-all ${
                tab === 'iphosts' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              IP Hosts
            </button>
            <button
              onClick={() => setTab('fwusers')}
              className={`px-4 py-2 text-sm font-medium rounded-lg transition-all ${
                tab === 'fwusers' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              Firewall Users
            </button>
          </div>
        )}

        {/* ── MAC Devices Tab ── */}
        {tab === 'devices' && (
          <>
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
                  onClick={() => sophosConnected && setShowAdd(true)}
                  disabled={!sophosConnected}
                  title={!sophosConnected ? 'Firewall not connected' : ''}
                  className="bg-blue-600 hover:bg-blue-700 text-white px-3 sm:px-5 py-2 sm:py-2.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-1 sm:gap-2 whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <span className="text-lg leading-none">+</span>
                  <span className="hidden xs:inline sm:inline">Add Device</span>
                </button>
              )}
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-20">
                <div className="animate-spin h-8 w-8 border-4 border-blue-600 border-t-transparent rounded-full" />
              </div>
            ) : filteredDevices.length === 0 ? (
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
                {filteredDevices.map((device) => (
                  <DeviceCard
                    key={device.id}
                    device={device}
                    onToggle={handleToggle}
                    onEdit={setEditDevice}
                    onDelete={handleDelete}
                    isAdmin={isAdmin}
                    sophosConnected={sophosConnected}
                  />
                ))}
              </div>
            )}
          </>
        )}

        {/* ── IP Hosts Tab (admin only) ── */}
        {tab === 'iphosts' && isAdmin && (
          <>
            <div className="grid grid-cols-3 gap-2 sm:gap-4 mb-4 sm:mb-6">
              <div className="bg-white rounded-xl border border-gray-200 p-3 sm:p-4 text-center">
                <div className="text-xl sm:text-2xl font-bold text-gray-900">{ipHosts.length}</div>
                <div className="text-xs sm:text-sm text-gray-500 mt-0.5">Total</div>
              </div>
              <div className="bg-green-50 rounded-xl border border-green-200 p-3 sm:p-4 text-center">
                <div className="text-xl sm:text-2xl font-bold text-green-700">{enabledIPCount}</div>
                <div className="text-xs sm:text-sm text-green-600 mt-0.5">Access ON</div>
              </div>
              <div className="bg-white rounded-xl border border-gray-200 p-3 sm:p-4 text-center">
                <div className="text-xl sm:text-2xl font-bold text-gray-500">{ipHosts.length - enabledIPCount}</div>
                <div className="text-xs sm:text-sm text-gray-500 mt-0.5">Access OFF</div>
              </div>
            </div>

            <div className="flex gap-2 mb-4 sm:mb-5">
              <input
                type="text"
                value={ipSearch}
                onChange={(e) => setIpSearch(e.target.value)}
                placeholder="Search IP hosts..."
                className="flex-1 border border-gray-300 rounded-lg px-3 sm:px-4 py-2 sm:py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
              />
              <button
                onClick={() => sophosConnected && setShowAddIP(true)}
                disabled={!sophosConnected}
                title={!sophosConnected ? 'Firewall not connected' : ''}
                className="bg-blue-600 hover:bg-blue-700 text-white px-3 sm:px-5 py-2 sm:py-2.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-1 sm:gap-2 whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <span className="text-lg leading-none">+</span>
                <span className="hidden xs:inline sm:inline">Add IP Host</span>
              </button>
            </div>

            {ipLoading ? (
              <div className="flex items-center justify-center py-20">
                <div className="animate-spin h-8 w-8 border-4 border-blue-600 border-t-transparent rounded-full" />
              </div>
            ) : filteredIPHosts.length === 0 ? (
              <div className="text-center py-20">
                {ipHosts.length === 0 ? (
                  <>
                    <div className="text-5xl mb-3">🌐</div>
                    <h3 className="text-lg font-semibold text-gray-700">No IP hosts yet</h3>
                    <p className="text-gray-400 mt-1 text-sm">Add an IP, IP range, or IP list to get started.</p>
                    <button
                      onClick={() => setShowAddIP(true)}
                      className="mt-4 bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-lg text-sm font-medium transition-colors"
                    >
                      Add First IP Host
                    </button>
                  </>
                ) : (
                  <>
                    <div className="text-4xl mb-2">🔍</div>
                    <p className="text-gray-500">No IP hosts match your search.</p>
                  </>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
                {filteredIPHosts.map((host) => (
                  <IPHostCard
                    key={host.id}
                    host={host}
                    onToggle={handleToggleIP}
                    onEdit={setEditIPHost}
                    onDelete={handleDeleteIP}
                    sophosConnected={sophosConnected}
                  />
                ))}
              </div>
            )}
          </>
        )}

        {/* ── Firewall Users Tab (admin only) ── */}
        {tab === 'fwusers' && isAdmin && (
          <>
            <div className="grid grid-cols-3 gap-2 sm:gap-4 mb-4 sm:mb-6">
              <div className="bg-white rounded-xl border border-gray-200 p-3 sm:p-4 text-center">
                <div className="text-xl sm:text-2xl font-bold text-gray-900">{fwUsers.length}</div>
                <div className="text-xs sm:text-sm text-gray-500 mt-0.5">Total</div>
              </div>
              <div className="bg-green-50 rounded-xl border border-green-200 p-3 sm:p-4 text-center">
                <div className="text-xl sm:text-2xl font-bold text-green-700">{activeFWCount}</div>
                <div className="text-xs sm:text-sm text-green-600 mt-0.5">Active</div>
              </div>
              <div className="bg-white rounded-xl border border-gray-200 p-3 sm:p-4 text-center">
                <div className="text-xl sm:text-2xl font-bold text-gray-500">{fwUsers.length - activeFWCount}</div>
                <div className="text-xs sm:text-sm text-gray-500 mt-0.5">Inactive</div>
              </div>
            </div>

            <div className="flex gap-2 mb-4 sm:mb-5">
              <input
                type="text"
                value={fwSearch}
                onChange={(e) => setFwSearch(e.target.value)}
                placeholder="Search by name, username, email, group..."
                className="flex-1 border border-gray-300 rounded-lg px-3 sm:px-4 py-2 sm:py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
              />
              <button
                onClick={() => sophosConnected && setShowAddFW(true)}
                disabled={!sophosConnected}
                title={!sophosConnected ? 'Firewall not connected' : ''}
                className="bg-blue-600 hover:bg-blue-700 text-white px-3 sm:px-5 py-2 sm:py-2.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-1 sm:gap-2 whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <span className="text-lg leading-none">+</span>
                <span className="hidden xs:inline sm:inline">Add User</span>
              </button>
            </div>

            {fwLoading ? (
              <div className="flex items-center justify-center py-20">
                <div className="animate-spin h-8 w-8 border-4 border-blue-600 border-t-transparent rounded-full" />
              </div>
            ) : filteredFWUsers.length === 0 ? (
              <div className="text-center py-20">
                {fwUsers.length === 0 ? (
                  <>
                    <div className="text-5xl mb-3">👤</div>
                    <h3 className="text-lg font-semibold text-gray-700">No firewall users yet</h3>
                    <p className="text-gray-400 mt-1 text-sm">Add a user to control their internet access by group.</p>
                    <button
                      onClick={() => setShowAddFW(true)}
                      className="mt-4 bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-lg text-sm font-medium transition-colors"
                    >
                      Add First User
                    </button>
                  </>
                ) : (
                  <>
                    <div className="text-4xl mb-2">🔍</div>
                    <p className="text-gray-500">No users match your search.</p>
                  </>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
                {filteredFWUsers.map((fu) => (
                  <FirewallUserCard
                    key={fu.username}
                    fwUser={fu}
                    onToggle={handleToggleFW}
                    onEdit={setEditFWUser}
                    onDelete={handleDeleteFW}
                    sophosConnected={sophosConnected}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </main>

      {showAdd && <AddDeviceModal onAdd={handleAdd} onClose={() => setShowAdd(false)} />}
      {showAddIP && <AddIPHostModal onAdd={handleAddIP} onClose={() => setShowAddIP(false)} />}
      {showAddFW && <AddFirewallUserModal onAdd={handleAddFW} onClose={() => setShowAddFW(false)} />}
      {showUsers && <UsersModal onClose={() => setShowUsers(false)} />}

      {showLogs && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4" onClick={() => setShowLogs(false)}>
          <div className="bg-white w-full sm:rounded-2xl sm:max-w-2xl rounded-t-2xl shadow-2xl max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 pb-6 pt-4 sm:p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-bold text-gray-900">Activity Logs</h2>
                <button onClick={() => setShowLogs(false)} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
              </div>
              <div className="space-y-2">
                {logs.length === 0 ? (
                  <p className="text-center text-gray-400 text-sm py-8">No activity yet.</p>
                ) : logs.map((log) => (
                  <div key={log.id} className="flex items-start gap-3 px-3 py-2.5 rounded-lg bg-gray-50 border border-gray-100">
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full flex-shrink-0 mt-0.5 ${
                      log.action === 'TOGGLE_ON' || log.action === 'IP_HOST_ON' ? 'bg-green-100 text-green-700' :
                      log.action === 'TOGGLE_OFF' || log.action === 'IP_HOST_OFF' ? 'bg-gray-200 text-gray-600' :
                      log.action === 'LOGIN_FAILED' ? 'bg-red-100 text-red-700' :
                      log.action === 'LOGIN' ? 'bg-blue-100 text-blue-700' :
                      log.action === 'DELETE_DEVICE' || log.action === 'DELETE_IP_HOST' ? 'bg-red-100 text-red-600' :
                      'bg-indigo-100 text-indigo-700'
                    }`}>{log.action.replace(/_/g, ' ')}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-gray-800">{log.user_email} {log.device_name && `→ ${log.device_name}`}</p>
                      {log.details && <p className="text-xs text-gray-400">{log.details}</p>}
                    </div>
                    <span className="text-xs text-gray-400 flex-shrink-0">{new Date(log.created_at + 'Z').toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {editDevice && (
        <EditDeviceModal
          device={editDevice}
          onSave={handleEdit}
          onClose={() => setEditDevice(null)}
        />
      )}
      {editIPHost && (
        <EditIPHostModal
          host={editIPHost}
          onSave={handleEditIP}
          onClose={() => setEditIPHost(null)}
        />
      )}
      {editFWUser && (
        <EditFirewallUserModal
          fwUser={editFWUser}
          onSave={handleEditFW}
          onClose={() => setEditFWUser(null)}
        />
      )}
    </div>
  )
}
