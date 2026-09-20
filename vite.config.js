import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

const SYS_TARGET = 'https://10.100.23.42:8189'

const sysProxy = { target: SYS_TARGET, secure: false, changeOrigin: true }

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],
  server: {
    // ==== 关键：让局域网能访问 ====
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    allowedHosts: true,   // 用 IP/域名访问时避免 Blocked request

    proxy: {
      '/energy-sys': {
        ...sysProxy,
        rewrite: (path) => path.replace(/^\/energy-sys/, '')
      },
      '/assets': sysProxy,
      '/prod-api': sysProxy
    }
  }
})