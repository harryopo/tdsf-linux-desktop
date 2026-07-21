import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [
      // 将 ESM-only 包从 external 中排除，让 vite 打包它们以处理 ESM/CJS 互操作
      // 这些包在 Electron CJS main 进程中直接 require() 会失败（如 nanoid@5.x 是 ESM-only）
      externalizeDepsPlugin({
        exclude: [
          'ai',
          '@ai-sdk/openai',
          '@modelcontextprotocol/sdk',
          '@volcengine/ark-runtime'
        ]
      })
    ],
    resolve: {
      alias: {
        '@main': resolve('src/main'),
        '@shared': resolve('src/shared')
      }
    },
    build: {
      rollupOptions: {
        external: ['better-sqlite3', 'ssh2', '@photostructure/sqlite-vec', /scripts\/promptfoo\/.*/]
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@': resolve('src/renderer/src'),
        '@renderer': resolve('src/renderer/src'),
        '@shared': resolve('src/shared')
      }
    },
    plugins: [react()],
    // 强制 IPv4 + 9876 端口（避开 Windows 保留的 8000-8505 范围）
    server: {
      host: '127.0.0.1',
      port: 9876,
      strictPort: false
    }
  }
})
