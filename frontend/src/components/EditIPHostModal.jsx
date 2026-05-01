import { useState } from 'react'

const IP_TYPES = ['IP', 'IPRange', 'IPList']

function parseInitialState(host) {
  if (host.ip_type === 'IPRange') {
    const [start, end] = host.ip_value.split('-')
    return { rangeStart: start?.trim() || '', rangeEnd: end?.trim() || '', singleIP: '', ipList: ['', ''] }
  }
  if (host.ip_type === 'IPList') {
    const ips = host.ip_value.split(',').map((s) => s.trim()).filter(Boolean)
    return { ipList: ips.length >= 2 ? ips : [...ips, ''], rangeStart: '', rangeEnd: '', singleIP: '' }
  }
  return { singleIP: host.ip_value, rangeStart: '', rangeEnd: '', ipList: ['', ''] }
}

export default function EditIPHostModal({ host, onSave, onClose }) {
  const init = parseInitialState(host)
  const [name, setName] = useState(host.name)
  const [ipType, setIpType] = useState(host.ip_type)
  const [singleIP, setSingleIP] = useState(init.singleIP)
  const [rangeStart, setRangeStart] = useState(init.rangeStart)
  const [rangeEnd, setRangeEnd] = useState(init.rangeEnd)
  const [ipList, setIpList] = useState(init.ipList)
  const [description, setDescription] = useState(host.description || '')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const addIPRow = () => setIpList((l) => [...l, ''])
  const removeIPRow = (i) => setIpList((l) => l.filter((_, idx) => idx !== i))
  const updateIP = (i, v) => setIpList((l) => l.map((ip, idx) => idx === i ? v : ip))

  const buildPayload = () => {
    if (!name.trim()) return { error: 'Name is required.' }
    if (ipType === 'IP') {
      if (!singleIP.trim()) return { error: 'IP address is required.' }
      return { payload: { name: name.trim(), ip_type: 'IP', ip_value: singleIP.trim(), description } }
    }
    if (ipType === 'IPRange') {
      if (!rangeStart.trim() || !rangeEnd.trim()) return { error: 'Start and end IP are required.' }
      return { payload: { name: name.trim(), ip_type: 'IPRange', ip_value: `${rangeStart.trim()}-${rangeEnd.trim()}`, description } }
    }
    if (ipType === 'IPList') {
      const filled = ipList.map((ip) => ip.trim()).filter(Boolean)
      if (filled.length < 2) return { error: 'Enter at least 2 IP addresses for a list.' }
      return { payload: { name: name.trim(), ip_type: 'IPList', ip_value: filled.join(','), description } }
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    const result = buildPayload()
    if (result.error) { setError(result.error); return }
    setLoading(true)
    const err = await onSave(host.name, result.payload)
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
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg sm:text-xl font-bold text-gray-900">Edit IP Host</h2>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none p-1">&times;</button>
          </div>

          <div className="flex bg-gray-100 rounded-lg p-1 mb-4">
            {IP_TYPES.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setIpType(t)}
                className={`flex-1 py-2 text-sm font-medium rounded-md transition-all ${
                  ipType === t ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {t === 'IPRange' ? 'IP Range' : t === 'IPList' ? 'IP List' : 'IP'}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Host Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                autoFocus
              />
            </div>

            {ipType === 'IP' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">IPv4 Address</label>
                <input
                  type="text"
                  value={singleIP}
                  onChange={(e) => setSingleIP(e.target.value)}
                  placeholder="192.168.1.10"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
            )}

            {ipType === 'IPRange' && (
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Start IP</label>
                  <input
                    type="text"
                    value={rangeStart}
                    onChange={(e) => setRangeStart(e.target.value)}
                    placeholder="192.168.1.1"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">End IP</label>
                  <input
                    type="text"
                    value={rangeEnd}
                    onChange={(e) => setRangeEnd(e.target.value)}
                    placeholder="192.168.1.50"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
              </div>
            )}

            {ipType === 'IPList' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  IP Addresses <span className="text-xs text-gray-400 font-normal">(min. 2)</span>
                </label>
                <div className="space-y-2">
                  {ipList.map((ip, i) => (
                    <div key={i} className="flex gap-2">
                      <input
                        type="text"
                        value={ip}
                        onChange={(e) => updateIP(i, e.target.value)}
                        placeholder={`192.168.1.${i + 1}`}
                        className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                      {ipList.length > 2 && (
                        <button
                          type="button"
                          onClick={() => removeIPRow(i)}
                          className="text-red-400 hover:text-red-600 px-2 text-xl leading-none font-bold flex-shrink-0"
                        >
                          &times;
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={addIPRow}
                  className="mt-2 text-sm text-blue-600 hover:text-blue-800 font-medium flex items-center gap-1"
                >
                  <span className="text-base leading-none">+</span> Add another IP
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
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2">
                {error}
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
                {loading ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
