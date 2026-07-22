# 04 · Vite 5 + electron-vite 2.3 构建栈 Skill 调研

> **项目版本**：Vite 5.4.0 + electron-vite 2.3.0 + @vitejs/plugin-react 4.3.0 + esbuild 0.28.1
> **核心定位**：构建工具链（主进程 + 预加载 + 渲染层三进程分离）
> **最后更新**：2026-07-22

---

## 1. 核心 Skill 速查

| Skill | 评级 | 来源 | 触发词 | 核心价值 |
|-------|------|------|--------|----------|
| `electron-vite` 官方文档 | ⭐⭐⭐必装 | electron-vite.org | "三进程构建" / "HMR" / "preload 配置" | 完整配置参考 |
| `vite` 官方文档 | ⭐⭐推荐 | vitejs.dev | "Vite 配置" / "插件" | 渲染层构建 |
| `vercel-react-best-practices` §Bundle | ⭐⭐推荐 | Vercel | "bundle 优化" | barrel-imports / dynamic-imports |

> **说明**：Vite 没有专门的 Skill 插件（社区通用），主要靠官方文档。electron-vite 是关键工具。

---

## 2. electron-vite 三进程架构

### 2.1 配置文件

```typescript
// electron.vite.config.ts
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/main',
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/main/index.ts') }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/preload',
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/preload/index.ts') }
      }
    }
  },
  renderer: {
    root: '.',
    plugins: [react()],
    build: {
      outDir: 'out/renderer',
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/renderer/index.html') }
      }
    },
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src/renderer/src'),
        '@shared': resolve(__dirname, 'src/shared'),
        '@main': resolve(__dirname, 'src/main')
      }
    }
  }
})
```

### 2.2 关键插件

| 插件 | 作用 | 必用 |
|------|------|------|
| `externalizeDepsPlugin` | 排除 deps 走 require/import（不打包 Node 原生） | ✅ 主/预都加 |
| `@vitejs/plugin-react` | React Fast Refresh + JSX | ✅ 渲染层 |
| `electron-vite` 内置 | 三进程拆分 | ✅ |

### 2.3 路径别名（与 tsconfig 同步）

```json
// tsconfig.web.json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/renderer/src/*"],
      "@shared/*": ["src/shared/*"],
      "@main/*": ["src/main/*"]
    }
  }
}
```

> **坑**：tsx 独立测试要加 `--tsconfig tsconfig.node.json` 才能解析 `@main/*`、`@shared/*`。

---

## 3. 渲染层 Vite 配置

### 3.1 Vite 5 必知

| 配置 | 用途 | 项目用法 |
|------|------|----------|
| `resolve.alias` | 路径别名 | `@/` `@shared/` `@main/` |
| `build.target` | 编译目标 | `chrome120`（Electron 43 Chromium） |
| `build.rollupOptions.output.manualChunks` | 拆包 | vendor / antd / monaco |
| `optimizeDeps.include` | 预构建 | `react` / `react-dom` / `monaco-editor` |
| `server.port` | dev server | 5173（默认） |
| `define` | 全局常量 | `__APP_VERSION__` |

### 3.2 项目 manualChunks 实战

```typescript
// electron.vite.config.ts renderer.build
rollupOptions: {
  output: {
    manualChunks: {
      'vendor-react': ['react', 'react-dom', 'react-router-dom'],
      'vendor-antd': ['antd', '@ant-design/icons'],
      'vendor-monaco': ['monaco-editor', '@monaco-editor/react'],
      'vendor-flow': ['reactflow', 'recharts', 'three'],
      'vendor-state': ['zustand', 'dexie']
    }
  }
}
```

**目的**：让 antd / monaco 这些大块独立 chunk，避免首屏白屏。

---

## 4. Bundle 优化（Vercel React 性能规则 · 5 条 CRITICAL）

> **来源**：`c:\Users\Lenovo\.trae-cn\skills\vercel-react-best-practices\rules\bundle-*`

### 4.1 `bundle-barrel-imports`（最重要）

```typescript
// ❌ 反例：barrel 文件
import { Button, Card, Form } from '@/components'

// ✅ 正例：直接 import
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Form } from '@/components/ui/form'
```

**原因**：barrel 让 Vite 把整个 components 目录打包进 chunk，bundle 爆炸。

### 4.2 `bundle-dynamic-imports`

```typescript
// ✅ 重组件 lazy load
const MonacoEditor = lazy(() => import('@monaco-editor/react').then(m => ({ default: m.default })))
const xterm = lazy(() => import('@xterm/xterm').then(m => ({ default: m.Terminal })))
const ReactFlow = lazy(() => import('reactflow'))

<Suspense fallback={<Skeleton />}>
  <MonacoEditor ... />
</Suspense>
```

### 4.3 `bundle-defer-third-party`

```typescript
// ✅ 分析 / 日志 hydration 后加载
useEffect(() => {
  import('./analytics').then(({ init }) => init())
}, [])
```

### 4.4 `bundle-conditional`

```typescript
// ✅ 按需加载模块
const exportModule = user.isAdmin
  ? () => import('./admin-tools')
  : null
```

### 4.5 `bundle-preload`

```typescript
// ✅ hover/focus 时预加载
const preload = () => { import('./HeavyComponent') }
<HeavyComponentTrigger onMouseEnter={preload} onFocus={preload} />
```

---

## 5. HMR（Hot Module Replacement）

### 5.1 渲染层 HMR

- Vite 默认开启 React Fast Refresh
- 修改 `.tsx` / `.css` 文件即时热更新
- 修改 `src/shared/` 会触发主进程 + 渲染层双 HMR

### 5.2 主进程 HMR

```typescript
// src/main/index.ts
if (process.env.ELECTRON_RENDERER_URL) {
  // dev 模式
  mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
} else {
  // production
  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
}
```

> **坑**：主进程修改需重启 Electron（无 HMR），可配 `electronmon` 监听。

---

## 6. 路径别名与 TypeScript 同步

### 6.1 必同步 3 处

```
[1] tsconfig.json + tsconfig.web.json + tsconfig.node.json
    → paths 别名
[2] electron.vite.config.ts
    → resolve.alias 别名
[3] src/renderer/src/ 等代码
    → import 使用别名
```

漏任一处 → 编译或运行报错。

### 6.2 常见错误

| 错误 | 根因 | 修复 |
|------|------|------|
| `@/components` 找不到 | tsconfig.paths 未配 | 加 paths |
| 渲染层 import 主进程模块 | tsconfig.web.json 限制 | 跨进程类型走 `@shared/` |
| `tsx test.ts` 找不到 `@main` | 默认 tsconfig 不含 paths | `--tsconfig tsconfig.node.json` |

---

## 7. 构建产物（out/ 目录）

```
out/
├── main/
│   ├── index.js                ← 主进程入口
│   └── ...                     ← 主进程 + 依赖（已 externalize）
├── preload/
│   ├── index.js
│   └── index.cjs               ← preload（.cjs 因 sandbox）
└── renderer/
    ├── index.html
    ├── assets/
    │   ├── index-xxx.js        ← 主 bundle
    │   ├── vendor-react-xxx.js ← React chunk
    │   ├── vendor-antd-xxx.js
    │   └── vendor-monaco-xxx.js
    └── ...
```

### 7.1 体积现状（v1.0 评估）

| 块 | 大小（约） | 优化方向 |
|----|-----------|----------|
| 主进程 | ~30 MB | externalize 后仅项目代码 |
| 预加载 | ~5 MB | 类似主进程 |
| 渲染层 | ~150 MB | vendor-antd 60MB / vendor-monaco 50MB / 项目代码 40MB |
| **总计** | **~185 MB** | 加上 Electron 250MB ≈ **400MB**（满足 R17 预算） |

---

## 8. electron-vite 常见错误速查

| 错误 | 根因 | 修复 |
|------|------|------|
| `Cannot find module 'electron'` | 主进程未 externalize | `externalizeDepsPlugin()` |
| `__dirname is not defined` | 渲染层用 Node 全局 | 用 `import.meta.url` |
| preload 不生效 | 路径错误 | `path.join(__dirname, '../preload/index.cjs')` |
| HMR 后样式丢失 | Tailwind 4 需 PostCSS 插件 | `@tailwindcss/postcss` |
| `Could not resolve 'antd'` | 路径别名未生效 | 检查 tsconfig + vite alias |

---

## 9. 性能优化清单

1. **manualChunks 拆 vendor**（react / antd / monaco / flow / state）
2. **lazy + Suspense 加载重组件**（Monaco / React Flow / 图表）
3. **避免 barrel imports**（直接路径）
4. **预构建常用 deps**（`optimizeDeps.include`）
5. **target 设为 `chrome120`**（Electron 43 Chromium）
6. **Tailwind v4 PostCSS 插件**（避免样式闪烁）
7. **路径别名 3 处同步**（tsconfig + vite + 代码）
8. **HMR 优先**（dev 模式 Fast Refresh）
9. **生产构建 `sourcemap: false`**（v1.0 体积优化）
10. **monaco 用 `MonacoEnvironment.getWorkerUrl`** 而非默认（CDN 模式）

---

## 10. 推荐阅读顺序

1. [electron-vite 官方文档](https://electron-vite.org/)（10 分钟）
2. [Vite 官方文档 - 配置](https://cn.vitejs.dev/config/)（按需查）
3. `c:\Users\Lenovo\.trae-cn\skills\vercel-react-best-practices\rules\bundle-*` 5 条
4. 项目 `electron.vite.config.ts` + `tsconfig.*.json` 实际配置

---

## 11. 引用文档

- [electron-vite.org](https://electron-vite.org/) — 官方文档
- [vitejs.dev](https://cn.vitejs.dev/) — Vite 官方
- `c:\Users\Lenovo\.trae-cn\skills\vercel-react-best-practices\SKILL.md` — Bundle 5 条
- `d:\ai\linux教学一体\tdsf-linux-desktop\AGENTS.md` v8.4 — 构建规约
- `d:\ai\linux教学一体\tdsf-linux-desktop\electron.vite.config.ts` — 项目实际配置
