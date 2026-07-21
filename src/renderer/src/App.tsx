/**
 * 应用根组件 - App（v1.0 重构）
 *
 * 职责：
 * - 引入 Router（20 条路由 + 守卫 + lazy 加载）
 * - 启动时从主进程 hydrate 服务器列表（v0.7.0 双重持久化策略）
 *
 * v1.0 变更：
 * - 路由从 6 条扩展到 20 条（含嵌套路由）
 * - 路由配置独立到 router.tsx
 * - 引入 Suspense + lazy 加载
 * - 引入 BootPage 启动页
 *
 * 保留：
 * - hydrateFromMain 逻辑（v0.7.0 双重持久化）
 * - HashRouter（Electron file:// 协议兼容）
 */
import { useEffect } from 'react'
import Router from './router'
import { useServerStore } from './stores/server-store'
import { logger } from './utils/logger'

/** App 应用根组件 */
const App: React.FC = () => {
  // v0.7.0 启动时从主进程加载服务器列表（双重持久化策略）
  useEffect(() => {
    void useServerStore
      .getState()
      .hydrateFromMain()
      .then(() => {
        logger.info('App', '从主进程 hydrate 服务器列表完成', {
          count: useServerStore.getState().servers.length,
        })
      })
      .catch((err: unknown) => {
        logger.error('App', 'hydrate 失败', { err: String(err) })
      })
  }, [])

  return <Router />
}

export default App
