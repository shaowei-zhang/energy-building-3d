import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],
  server: {
    host: '0.0.0.0', // 或者写 true，表示监听所有 IP 地址
    port: 5173,      // 指定端口，如果被占用可以改成其他端口
    strictPort: false, // 如果端口被占用，是否直接退出（false表示自动换端口）
  }
})