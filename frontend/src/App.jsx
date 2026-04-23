import { useEffect, useState } from 'react'
import Login from './components/Login'
import Dashboard from './components/Dashboard'

export default function App() {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  const loginWithToken = (token) => {
    localStorage.setItem('ng_token', token)
    try {
      const payload = JSON.parse(atob(token.split('.')[1]))
      setUser({ email: payload.email, name: payload.name, role: payload.role || 'user' })
    } catch {
      localStorage.removeItem('ng_token')
    }
  }

  useEffect(() => {
    const saved = localStorage.getItem('ng_token')
    if (saved) {
      try {
        const payload = JSON.parse(atob(saved.split('.')[1]))
        if (payload.exp * 1000 > Date.now()) {
          setUser({ email: payload.email, name: payload.name, role: payload.role || 'user' })
        } else {
          localStorage.removeItem('ng_token')
        }
      } catch {
        localStorage.removeItem('ng_token')
      }
    }
    setLoading(false)
  }, [])

  const logout = () => {
    localStorage.removeItem('ng_token')
    setUser(null)
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin h-8 w-8 border-4 border-blue-600 border-t-transparent rounded-full" />
      </div>
    )
  }

  return user
    ? <Dashboard user={user} onLogout={logout} />
    : <Login onLogin={loginWithToken} />
}
