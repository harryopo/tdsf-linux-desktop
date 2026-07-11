import { resolve } from 'path'
import { defineConfig } from 'vitest/config'

/**
 * Vitest 配置
 *
 * 配置路径别名，使测试文件能解析源代码中的 @shared/* 和 @main/* 别名。
 *better-sqlite3 和 @photostructure/sqlite-vec 是原生模块，
 * 在纯 Node 测试环境中可能不可用（NODE_MODULE_VERSION 不匹配），
 * 测试中使用 vi.mock 或 try-catch 降级处理。
 */
export default defineConfig({
  resolve: {
    alias: {
      '@main': resolve(__dirname, 'src/main'),
      '@shared': resolve(__dirname, 'src/shared')
    }
  },
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['node_modules', 'out'],
    environment: 'node'
  }
})
