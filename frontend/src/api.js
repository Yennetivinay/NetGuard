import axios from 'axios'

const baseURL = import.meta.env.VITE_API_URL || ''

const api = axios.create({ baseURL })

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
