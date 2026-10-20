import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const target = process.env.VITE_API_TARGET ?? 'http://localhost:5150'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    // 产物直接落进 Server 的 wwwroot，dotnet run / 镜像里的 Server 都能托管控制台。
    // 不能清空目录：wwwroot/apps 下是 Server 用来生成安装清单的 yaml 模板。
    outDir: '../KubeSpoke.Server/wwwroot',
    emptyOutDir: false,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target, changeOrigin: true, ws: true },
      '/cluster-agent': { target, changeOrigin: true, ws: true },
      '/pod-log': { target, changeOrigin: true, ws: true },
    },
  },
})
