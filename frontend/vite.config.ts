import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        // 把体积大、变动少的第三方库拆成独立 chunk：
        // 既减小主包、又能被浏览器长期缓存（业务代码更新时无需重下）。
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return
          if (id.includes('@tiptap') || id.includes('prosemirror')) return 'editor'
          if (id.includes('recharts') || id.includes('/d3-') || id.includes('d3-')) return 'charts'
          if (id.includes('lucide-react')) return 'icons'
          if (id.includes('@tanstack')) return 'query'
          if (id.includes('react-router')) return 'router'
          if (id.includes('/react-dom/') || id.includes('/react/') || id.includes('/scheduler/')) return 'react-vendor'
          return 'vendor'
        },
      },
    },
  },
  server: {
    host: '0.0.0.0',
    port: process.env.PORT ? parseInt(process.env.PORT) : undefined,
    allowedHosts: true,
    proxy: {
      // 用 127.0.0.1 而非 localhost：Windows 上 localhost 会先解析到 IPv6 ::1，
      // 而后端绑定的是 IPv4，导致每个请求多等 ~2s 的连接回退（整站卡顿根因）。
      '/api': 'http://127.0.0.1:8000',
      '/health': 'http://127.0.0.1:8000',
      '/mcp': 'http://127.0.0.1:8000',
    },
  },
})
