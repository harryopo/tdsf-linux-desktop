# 02 · React 18 核心栈 Skill 调研

> **项目版本**：React 18.3.0 · ReactDOM 18.3.0 · React Router 6.26 · React Flow 11.11
> **核心定位**：渲染层 UI 框架（Electron 浏览器进程）
> **最后更新**：2026-07-22

---

## 1. 核心 Skill 速查

| Skill | 评级 | 来源 | 触发词 | 核心价值 |
|-------|------|------|--------|----------|
| `vercel-react-best-practices` | ⭐⭐⭐必装 | Vercel 官方 | "React 性能" / "Next.js 优化" | 65 条规则 8 大类 |
| `react-expert` | ⭐⭐推荐 | 社区 | "组件架构" / "Hooks" / "React 19" | 6 大 reference + 19 特性 |
| `vercel-composition-patterns` | ⭐⭐推荐 | Vercel 官方 | "组件设计" / "compound components" | 4 大类 8 条规则 |
| `vercel-react-view-transitions` | ⭐可选 | Vercel 官方 | "页面切换动画" | View Transition API |

> **Skill 路径**：
> - `c:\Users\Lenovo\.trae-cn\skills\vercel-react-best-practices\SKILL.md`（57 rules 文件）
> - `c:\Users\Lenovo\.trae-cn\skills\react-expert\SKILL.md`（6 references）
> - `c:\Users\Lenovo\.trae-cn\skills\vercel-composition-patterns\SKILL.md`（8 rules）

---

## 2. Vercel React 性能规则集（必装 · 65 条规则）

> **来源**：`c:\Users\Lenovo\.trae-cn\skills\vercel-react-best-practices\SKILL.md`
> **优先级**：按 Impact 排序

### 2.1 8 大类别（按优先级）

| 优先级 | 类别 | Impact | 数量 | 项目应用 |
|--------|------|--------|------|----------|
| 1 | 消除 waterfall（异步） | CRITICAL | 5 | ⭐⭐⭐ |
| 2 | Bundle 大小优化 | CRITICAL | 5 | ⭐⭐⭐ |
| 3 | 服务端性能 | HIGH | 9 | ⭐（项目用 Electron 非 Next） |
| 4 | 客户端数据获取 | MEDIUM-HIGH | 4 | ⭐⭐ |
| 5 | Re-render 优化 | MEDIUM | 12 | ⭐⭐⭐ |
| 6 | 渲染性能 | MEDIUM | 10 | ⭐⭐ |
| 7 | JS 性能 | LOW-MEDIUM | 11 | ⭐⭐ |
| 8 | 高级模式 | LOW | 3 | ⭐ |

### 2.2 高频规则精选（按项目实战频率）

#### A. Bundle 优化（CRITICAL）

- **`bundle-barrel-imports`**：直接 import，不要 `import { x } from '@/components'`（barrel）
  ```typescript
  // ❌ 错
  import { Button } from '@/components'
  // ✅ 对
  import { Button } from '@/components/ui/button'
  ```
- **`bundle-dynamic-imports`**：重组件用 `React.lazy` + `<Suspense>`
- **`bundle-defer-third-party`**：Analytics / Logger 在 hydration 后加载

#### B. 异步消除 waterfall（CRITICAL）

- **`async-parallel`**：独立 IO 用 `Promise.all`
- **`async-defer-await`**：把 `await` 推后到真正需要的地方
- **`async-suspense-boundaries`**：用 Suspense 流式渲染

#### C. Re-render 优化（MEDIUM）

- **`rerender-memo`**：昂贵组件包 `React.memo`
- **`rerender-defer-reads`**：回调里用的状态别订阅
- **`rerender-dependencies`**：effect 用 primitive deps
- **`rerender-derived-state`**：订阅 derived boolean，不订阅 raw value
- **`rerender-derived-state-no-effect`**：render 期间 derive，不用 effect
- **`rerender-functional-setstate`**：`setCount(c => c + 1)` 而非 `setCount(count + 1)`
- **`rerender-move-effect-to-event`**：交互触发的逻辑放 event，不放 effect
- **`rerender-use-deferred-value`**：高开销 input 用 `useDeferredValue`
- **`rerender-use-ref-transient-values`**：瞬时值用 `useRef`，不触发 re-render
- **`rerender-lazy-state-init`**：`useState(() => expensive())` 懒初始化

#### D. 渲染性能（MEDIUM）

- **`rendering-conditional-render`**：条件分支用三元，不与 0 共存
- **`rendering-hoist-jsx`**：稳定 JSX 提到组件外
- **`rendering-content-visibility`**：`content-visibility: auto` 跳过屏幕外
- **`rendering-usetransition-loading`**：loading 状态用 `useTransition`

#### E. JS 性能（LOW-MEDIUM）

- **`js-set-map-lookups`**：用 `Set` / `Map` 替代 `Array.find`（O(1) vs O(n)）
- **`js-index-maps`**：建 `Map<id, item>` 加速查找
- **`js-cache-property-access`**：循环里访问的属性先存到变量
- **`js-hoist-regexp`**：正则字面量提到模块级
- **`js-batch-dom-css`**：DOM 读 / 写分开，避免 layout thrash
- **`js-tosorted-immutable`**：不要 `.sort()` 改原数组
- **`js-early-exit`**：早 return，避免不必要计算
- **`js-length-check-first`**：length 检查在前
- **`js-flatmap-filter`**：filter + map 用 flatMap 合并

---

## 3. React Expert（react-expert Skill · 推荐）

> **来源**：`c:\Users\Lenovo\.trae-cn\skills\react-expert\SKILL.md` + 6 references

### 3.1 6 大 Reference 索引

| Reference | Load When |
|-----------|-----------|
| `references/server-components.md` | RSC 模式 / Next.js App Router（**项目不用，纯 CSR**） |
| `references/react-19-features.md` | `use()` / `useActionState` / forms |
| `references/state-management.md` | Context / Zustand / Redux / TanStack |
| `references/hooks-patterns.md` | Custom hooks / useEffect / useCallback |
| `references/performance.md` | memo / lazy / virtualization |
| `references/migration-class-to-modern.md` | 类组件 → Hooks/RSC |
| `references/testing-react.md` | Testing Library / mocking |

### 3.2 MUST DO（强制）

- TypeScript strict 模式
- 错误边界（Error Boundary）
- `key` prop 稳定 + 唯一
- Effect 清理（return cleanup）
- 语义化 HTML + ARIA
- memoize callbacks/objects 传给 memoized children
- Suspense 边界包裹 async

### 3.3 MUST NOT DO（禁止）

- 直接 mutate state
- 动态列表用 array index 做 key
- JSX 内创建函数（引发 re-render）
- useEffect 漏 cleanup（内存泄漏）
- 忽略 React strict mode 警告

---

## 4. Composition Patterns（Vercel 组件设计模式）

> **来源**：`c:\Users\Lenovo\.trae-cn\skills\vercel-composition-patterns\SKILL.md`

### 4.1 4 大类别 · 8 条规则

| 类别 | 规则 | 用途 |
|------|------|------|
| **Architecture** | `architecture-avoid-boolean-props` | 不用 boolean props 改行为（用 composition） |
| | `architecture-compound-components` | 复杂组件用 context 共享 |
| **State** | `state-decouple-implementation` | Provider 唯一持有 state 实现 |
| | `state-context-interface` | state/actions/meta 通用接口 |
| | `state-lift-state` | state 提到 provider 供 sibling |
| **Patterns** | `patterns-explicit-variants` | 显式 variant 组件代替 boolean 模式 |
| | `patterns-children-over-render-props` | children 优先于 renderX props |
| **React 19** | `react19-no-forwardref` | 不用 forwardRef，用 `use()` |

### 4.2 项目实战案例

**❌ 反例（boolean props 增殖）**：
```tsx
<Modal isOpen={x} isClosable={y} hasFooter={z} isLarge={w} />
```

**✅ 正例（compound components）**：
```tsx
<Modal open={x} onClose={y}>
  <Modal.Title>标题</Modal.Title>
  <Modal.Body>内容</Modal.Body>
  <Modal.Footer>
    <Button>确认</Button>
  </Modal.Footer>
</Modal>
```

### 4.3 触发场景

- refactor 组件出现 boolean prop 增殖
- 设计可复用 component library
- 涉及 compound components / context providers / 组件架构

---

## 5. 项目 React 实战最佳实践

### 5.1 状态管理（Zustand · 详见 08）

```typescript
// ✅ 一个模块一个 Store
src/renderer/src/store/chatStore.ts → useChatStore
src/renderer/src/store/settingsStore.ts → useSettingsStore

// ✅ Store 接口先行
interface ChatStore {
  messages: Message[]
  input: string
  setInput: (s: string) => void
  send: () => Promise<void>
}
```

### 5.2 性能优化

| 场景 | 方案 | 来源 |
|------|------|------|
| 大列表渲染 | `react-window` / `react-virtuoso` 虚拟化 | `react-expert/references/performance.md` |
| 路由切换卡顿 | `<Suspense fallback={<Loading/>}>` | `async-suspense-boundaries` |
| 编辑器卡顿 | Monaco `lazy load` + `onMount` 缓存 | 详见 07 |
| 终端卡顿 | xterm 单独 webview 隔离 | 详见 07 |
| AI 流式响应 | `useDeferredValue` + `useTransition` | `rerender-use-deferred-value` |

### 5.3 组件设计规约

- 一个文件一个组件（除非 compound）
- 组件文件 < 300 行（超长拆分子组件）
- 命名：PascalCase 文件名（`AIPanel.tsx`）
- props 用 TypeScript interface，禁 inline type
- 不在 JSX 内创建函数（提到组件外或 `useCallback`）
- 条件分支用三元 + `0` 兼容（`{x && <X/>}` → `{x ? <X/> : null}`）

---

## 6. View Transition API（v1.5+ 评估）

> **来源**：`c:\Users\Lenovo\.trae-cn\skills\vercel-react-view-transitions\SKILL.md`

| Pattern | 用途 | 项目场景 |
|---------|------|----------|
| **Shared element** (`name`) | 同一元素深层跳转 | Settings 列表 → 详情 |
| **Suspense reveal** | 数据加载完成 | 知识库搜索结果 |
| **List identity** | 列表重排 | 历史记录排序 |
| **State change** | 元素 enter/exit | 弹窗 / toast |
| **Route change** | 路由切换 | Workbench 标签页 |

**注意事项**：
- Electron Chromium 内核版本需 ≥ 111
- 不支持时浏览器 graceful degradation（无动画，不报错）
- 项目 React 18.3 需 `react@canary` 升级到 19 才能用 `<ViewTransition>`

---

## 7. React 项目已踩坑

| 踩坑 | 根因 | 修复 |
|------|------|------|
| `useEffect` 死循环 | deps 引用对象每次新建 | 用 `useMemo` 或原始值 |
| 子组件莫名 re-render | 父组件传 inline object | `useMemo` 或提到外部 |
| Monaco 加载后 UI 闪白 | bundle 太大 | `React.lazy` + `Suspense` |
| React Flow 节点拖动卡顿 | 自定义节点过重 | memo + 拆分小组件 |
| Antd Form 性能差 | 每次输入全表 re-render | `Form.useWatch` 细粒度订阅 |

---

## 8. 推荐阅读顺序

1. `c:\Users\Lenovo\.trae-cn\skills\vercel-react-best-practices\SKILL.md`（5 分钟概览）
2. `c:\Users\Lenovo\.trae-cn\skills\vercel-composition-patterns\SKILL.md`（组件设计 5 分钟）
3. 按需读 `rules/` 下具体规则（每个 2 分钟）
4. [React 官方](https://react.dev/) — useEffect / useState 深入

---

## 9. 引用文档

- `c:\Users\Lenovo\.trae-cn\skills\vercel-react-best-practices\` — 65 rules
- `c:\Users\Lenovo\.trae-cn\skills\react-expert\` — 6 references
- `c:\Users\Lenovo\.trae-cn\skills\vercel-composition-patterns\` — 8 rules
- `c:\Users\Lenovo\.trae-cn\skills\vercel-react-view-transitions\` — 5 patterns
- `d:\ai\linux教学一体\tdsf-linux-desktop\AGENTS.md` v8.4 — React 编码规约
