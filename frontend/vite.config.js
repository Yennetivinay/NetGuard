import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/auth': 'http://localhost:8000',
      '/api': 'http://localhost:8000',
      '/devices': 'http://localhost:8000',
      '/groups': 'http://localhost:8000',
      '/health': 'http://localhost:8000',
      '/users': 'http://localhost:8000',
    },
  },
})
