import { useState } from 'react'

const GROUP_COLORS = {
  'Students':    'bg-blue-50 text-blue-700 border-blue-100',
  'Teachers':    'bg-purple-50 text-purple-700 border-purple-100',
  'Open Group':  'bg-green-50 text-green-700 border-green-100',
  'Guest Group': 'bg-orange-50 text-orange-700 border-orange-100',
}

function Toggle({ enabled, onChange, disabled }) {
  return (
    <button
      onClick={() => !disabled && onChange()}
      disabled={disabled}
      className={`relative inline-flex h-7 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 ${
        enabled ? 'bg-green-500' : 'bg-gray-300'
      } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
      style={{ width: '52px' }}
      title={enabled ? 'Active — click to deactivate' : 'Inactive — click to activate'}
    >
      <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-md transition-transform duration-200 ${
        enabled ? 'translate-x-7' : 'translate-x-1'
      }`} />
    </button>
  )
}

export default function FirewallUserCard({ fwUser, onToggle, onEdit, onDelete, sophosConnected }) {
  const [toggling, setToggling] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const isActive = fwUser.status === 'Active'

  const handleToggle = async () => {
    setToggling(true)
    await onToggle(fwUser.username)
    setToggling(false)
  }

  const handleDelete = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true)
      setTimeout(() => setConfirmDelete(false), 3000)
      return
    }
    setDeleting(true)
    await onDelete(fwUser.username)
    setDeleting(false)
  }

  const groupColor = GROUP_COLORS[fwUser.group] || 'bg-gray-100 text-gray-600 border-gray-200'
  const initials = fwUser.name
    ? fwUser.name.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2)
    : fwUser.username[0].toUpperCase()

  return (
    <div className={`bg-white rounded-xl border-2 p-4 shadow-sm transition-all duration-200 ${
      isActive ? 'border-green-200 bg-green-50' : 'border-gray-200'
    }`}>
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0 ${
            isActive ? 'bg-green-200 text-green-800' : 'bg-gray-200 text-gray-600'
          }`}>
            {initials}
          </div>
          <div className="min-w-0">
            <h3 className="font-semibold text-gray-900 text-sm sm:text-base truncate">{fwUser.name || fwUser.username}</h3>
            <p className="text-xs text-gray-400 truncate">@{fwUser.username}</p>
          </div>
        </div>
        <Toggle enabled={isActive} onChange={handleToggle} disabled={toggling || !sophosConnected} />
      </div>

      {/* Email */}
      <div className="bg-gray-100 rounded-lg px-3 py-2 mb-3">
        <p className="text-xs text-gray-400 font-medium mb-0.5">EMAIL</p>
        <p className="text-xs text-gray-700 truncate">{fwUser.email || '—'}</p>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-full ${
            isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isActive ? 'bg-green-500' : 'bg-gray-400'}`} />
            {isActive ? 'Active' : 'Inactive'}
          </span>
          <span className={`text-xs font-medium px-2 py-1 rounded-full border ${groupColor}`}>
            {fwUser.group || '—'}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => sophosConnected && onEdit(fwUser)}
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
              confirmDelete ? 'bg-red-500 text-white hover:bg-red-600' : 'bg-gray-100 text-gray-500 hover:bg-red-50 hover:text-red-500'
            } ${(deleting || !sophosConnected) ? 'opacity-40 cursor-not-allowed' : ''}`}
          >
            {deleting ? '...' : confirmDelete ? 'Confirm?' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  )
}
