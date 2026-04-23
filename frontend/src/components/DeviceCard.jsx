import { useState } from 'react'

function Toggle({ enabled, onChange, disabled }) {
  return (
    <button
      onClick={() => !disabled && onChange()}
      disabled={disabled}
      className={`relative inline-flex h-7 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 ${
        enabled ? 'bg-green-500' : 'bg-gray-300'
      } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
      style={{ width: '52px' }}
      title={enabled ? 'Internet enabled — click to disable' : 'Internet disabled — click to enable'}
    >
      <span
        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-md transition-transform duration-200 ${
          enabled ? 'translate-x-7' : 'translate-x-1'
        }`}
      />
    </button>
  )
}

export default function DeviceCard({ device, onToggle, onEdit, onDelete, isAdmin, sophosConnected }) {
  const [toggling, setToggling] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const handleToggle = async () => {
    setToggling(true)
    await onToggle(device.id)
    setToggling(false)
  }

  const handleDelete = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true)
      setTimeout(() => setConfirmDelete(false), 3000)
      return
    }
    setDeleting(true)
    await onDelete(device.id)
    setDeleting(false)
  }

  const formatMAC = (mac) => {
    const clean = mac.replace(/[^0-9a-fA-F]/g, '')
    return clean.match(/.{1,2}/g)?.join(':').toUpperCase() || mac.toUpperCase()
  }

  const parsedMacs = (() => {
    try {
      const list = JSON.parse(device.mac_addresses || '[]')
      return Array.isArray(list) && list.length > 0 ? list : null
    } catch { return null }
  })()

  const dateStr = new Date(device.created_at + 'Z').toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })

  return (
    <div className={`bg-white rounded-xl border-2 p-4 shadow-sm transition-all duration-200 ${
      device.is_enabled ? 'border-green-200 bg-green-50' : 'border-gray-200'
    }`}>
      {/* Name + Toggle */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-gray-900 truncate text-sm sm:text-base">{device.name}</h3>
          {device.description && (
            <p className="text-gray-500 text-xs sm:text-sm truncate mt-0.5">{device.description}</p>
          )}
        </div>
        <Toggle
          enabled={device.is_enabled}
          onChange={handleToggle}
          disabled={toggling || !sophosConnected}
          title={!sophosConnected ? 'Firewall not connected' : ''}
        />
      </div>

      {/* MAC display */}
      {parsedMacs ? (
        <div className="bg-gray-100 rounded-lg px-3 py-2 mb-3">
          <p className="text-xs text-gray-400 mb-1 font-medium">MAC LIST ({parsedMacs.length})</p>
          {parsedMacs.map((mac, i) => (
            <p key={i} className="font-mono text-xs text-gray-700 tracking-wider leading-5 break-all">{mac}</p>
          ))}
        </div>
      ) : (
        <div className="bg-gray-100 rounded-lg px-3 py-2 font-mono text-xs sm:text-sm text-gray-700 mb-3 tracking-wider break-all">
          {formatMAC(device.mac_address)}
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-full ${
          device.is_enabled ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
        }`}>
          <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${device.is_enabled ? 'bg-green-500' : 'bg-gray-400'}`} />
          {device.is_enabled ? 'Internet ON' : 'Internet OFF'}
        </span>

        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400 hidden sm:inline">{dateStr}</span>
          <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-600 font-medium border border-indigo-100">
            {device.group || 'School'}
          </span>
          {isAdmin && (
            <>
              <button
                onClick={() => sophosConnected && onEdit(device)}
                disabled={!sophosConnected}
                title={!sophosConnected ? 'Firewall not connected' : ''}
                className="text-xs px-2.5 py-1.5 rounded-lg bg-gray-100 text-gray-500 hover:bg-blue-50 hover:text-blue-600 transition-colors font-medium disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Edit
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting || !sophosConnected}
                title={!sophosConnected ? 'Firewall not connected' : ''}
                className={`text-xs px-2.5 py-1.5 rounded-lg transition-colors font-medium ${
                  confirmDelete
                    ? 'bg-red-500 text-white hover:bg-red-600'
                    : 'bg-gray-100 text-gray-500 hover:bg-red-50 hover:text-red-500'
                } ${(deleting || !sophosConnected) ? 'opacity-40 cursor-not-allowed' : ''}`}
              >
                {deleting ? '...' : confirmDelete ? 'Confirm?' : 'Delete'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
