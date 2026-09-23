import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

const SYS_TARGET = 'https://10.100.23.42:8189'

const sysProxy = { target: SYS_TARGET, secure: false, changeOrigin: true }

// 江宁平面图自定义数据的落盘位置（src/mock/jiangning-plan.json）
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const JIANGNING_MOCK_FILE = path.join(__dirname, 'src/mock/jiangning-plan.json')

// 轻量持久化中间件：浏览器侧的新建 / 删除直接写入 mock 文件（仅 dev server 生效）
function mockPersistencePlugin() {
  return {
    name: 'jiangning-mock-persistence',
    configureServer(server) {
      server.middlewares.use('/mock-api/jiangning', (req, res) => {
        if (req.method === 'GET') {
          try {
            const data = fs.existsSync(JIANGNING_MOCK_FILE)
              ? fs.readFileSync(JIANGNING_MOCK_FILE, 'utf-8')
              : JSON.stringify({ rooms: [], removedIds: [] })
            res.setHeader('Content-Type', 'application/json; charset=utf-8')
            res.end(data)
          } catch (err) {
            res.statusCode = 500
            res.end(JSON.stringify({ error: err.message }))
          }
          return
        }
        if (req.method === 'PUT' || req.method === 'POST') {
          let body = ''
          req.on('data', (chunk) => { body += chunk })
          req.on('end', () => {
            try {
              const parsed = JSON.parse(body)
              const payload = {
                rooms: Array.isArray(parsed.rooms) ? parsed.rooms : [],
                removedIds: Array.isArray(parsed.removedIds) ? parsed.removedIds : []
              }
              fs.mkdirSync(path.dirname(JIANGNING_MOCK_FILE), { recursive: true })
              fs.writeFileSync(JIANGNING_MOCK_FILE, JSON.stringify(payload, null, 2) + '\n', 'utf-8')
              // 让 vite 的文件监听感知到变化（不影响 import，仅保持 dev 状态一致）
              server.watcher.emit('change', JIANGNING_MOCK_FILE)
              res.setHeader('Content-Type', 'application/json; charset=utf-8')
              res.end(JSON.stringify({ ok: true }))
            } catch (err) {
              res.statusCode = 400
              res.end(JSON.stringify({ error: err.message }))
            }
          })
          return
        }
        res.statusCode = 405
        res.end()
      })
    }
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue(), mockPersistencePlugin()],
  server: {
    // ==== 关键：让局域网能访问 ====
    host: '0.0.0.0',
    port: 5174,
    strictPort: true,
    allowedHosts: true,   // 用 IP/域名访问时避免 Blocked request

    proxy: {
      '/energy-sys': {
        ...sysProxy,
        rewrite: (p) => p.replace(/^\/energy-sys/, '')
      },
      '/assets': sysProxy,
      '/prod-api': sysProxy
    }
  }
})
