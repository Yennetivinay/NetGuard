import axios from 'axios'

const baseURL = import.meta.env.VITE_API_URL ||
  (window.location.hostname === 'localhost'
    ? 'http://localhost:8000'
    : `http://${window.location.hostname}:8000`)

const api = axios.create({ baseURL })
api.defaults.headers.common['ngrok-skip-browser-warning'] = 'true'
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('ng_token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('ng_token')
      window.location.href = '/'
    }
    return Promise.reject(err)
  }
)

export default api
