import { useState } from 'react'

function MacInput({ value, onChange, onRemove, showRemove, placeholder }) {
  return (
    <div className="flex gap-2">
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder || 'AA:BB:CC:DD:EE:FF'}
        className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
      />
      {showRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="text-red-400 hover:text-red-600 px-2 text-xl leading-none font-bold flex-shrink-0"
        >
          &times;
        </button>
      )}
    </div>
  )
}

export default function AddDeviceModal({ onAdd, onClose }) {
  const [mode, setMode] = useState('single')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [singleMac, setSingleMac] = useState('')
  const [macList, setMacList] = useState(['', ''])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const addMacRow = () => setMacList((m) => [...m, ''])
  const removeMacRow = (i) => setMacList((m) => m.filter((_, idx) => idx !== i))
  const updateMac = (i, v) => setMacList((m) => m.map((mac, idx) => idx === i ? v : mac))

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    if (!name.trim()) { setError('Name is required.'); return }

    let payload = { name: name.trim(), description }
    if (mode === 'single') {
      if (!singleMac.trim()) { setError('MAC address is required.'); return }
      payload.mac_address = singleMac.trim()
    } else {
      const filled = macList.map((m) => m.trim()).filter(Boolean)
      if (filled.length < 2) { setError('Enter at least 2 MAC addresses for a list.'); return }
      payload.mac_addresses = filled
    }

    setLoading(true)
    const err = await onAdd(payload)
    setLoading(false)
    if (err) setError(err)
    else onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4" onClick={onClose}>
      <div
        className="bg-white w-full sm:rounded-2xl sm:max-w-md rounded-t-2xl shadow-2xl max-h-[92vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-center pt-3 pb-1 sm:hidden">
          <div className="w-10 h-1 bg-gray-300 rounded-full" />
        </div>

        <div className="px-5 pb-6 pt-2 sm:p-6">
          <div className="flex items-center justify-between mb-4 sm:mb-5">
            <h2 className="text-lg sm:text-xl font-bold text-gray-900">Add Device</h2>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none p-1">&times;</button>
          </div>

          <div className="flex bg-gray-100 rounded-lg p-1 mb-4 sm:mb-5">
            <button
              type="button"
              onClick={() => setMode('single')}
              className={`flex-1 py-2 text-sm font-medium rounded-md transition-all ${
                mode === 'single' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              Single MAC
            </button>
            <button
              type="button"
              onClick={() => setMode('list')}
              className={`flex-1 py-2 text-sm font-medium rounded-md transition-all ${
                mode === 'list' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              MAC List
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Device Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. John's Laptop"
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                autoFocus
              />
            </div>

            {mode === 'single' ? (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">MAC Address</label>
                <input
                  type="text"
                  value={singleMac}
                  onChange={(e) => setSingleMac(e.target.value)}
                  placeholder="AA:BB:CC:DD:EE:FF"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                <p className="text-xs text-gray-400 mt-1">Any format: AA:BB:CC:DD:EE:FF or AABBCCDDEEFF</p>
              </div>
            ) : (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  MAC Addresses <span className="text-xs text-gray-400 font-normal">(min. 2)</span>
                </label>
                <div className="space-y-2">
                  {macList.map((mac, i) => (
                    <MacInput
                      key={i}
                      value={mac}
                      onChange={(v) => updateMac(i, v)}
                      onRemove={() => removeMacRow(i)}
                      showRemove={macList.length > 2}
                      placeholder={`MAC ${i + 1}`}
                    />
                  ))}
                </div>
                <button
                  type="button"
                  onClick={addMacRow}
                  className="mt-2 text-sm text-blue-600 hover:text-blue-800 font-medium flex items-center gap-1"
                >
                  <span className="text-base leading-none">+</span> Add another MAC
                </button>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Description <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g. Finance department PC"
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2">
                {typeof error === 'string' ? error : JSON.stringify(error)}
              </div>
            )}

            <div className="flex gap-3 pt-1">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 border border-gray-300 text-gray-700 py-2.5 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading}
                className="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-2.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? 'Adding...' : 'Add Device'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
