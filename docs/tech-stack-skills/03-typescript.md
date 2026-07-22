# 03 · TypeScript 5.4 核心栈 Skill 调研

> **项目版本**：TypeScript 5.4.0（strict 模式）· 2 套 tsconfig（node / web）· 1 套 electron.d.ts
> **核心定位**：全栈类型系统（主进程 + 预加载 + 渲染层）
> **最后更新**：2026-07-22

---

## 1. 核心 Skill 速查

| Skill | 评级 | 来源 | 触发词 | 核心价值 |
|-------|------|------|--------|----------|
| `typescript` | ⭐⭐⭐必装 | 社区 / Microsoft 风格指南 | "TS 风格" / "类型" | 18 章完整规范 |
| `typescript-advanced-types` | ⭐可选 | 社区 | "泛型" / "条件类型" / "模板字面量" | 高级类型体操 |

> **Skill 路径**：
> - `c:\Users\Lenovo\.trae-cn\skills\typescript\SKILL.md`（18 章，500+ 行）

---

## 2. TypeScript Style Guide（18 章速查）

> **来源**：`c:\Users\Lenovo\.trae-cn\skills\typescript\SKILL.md`

| # | 章节 | 关键规则 | 项目应用 |
|---|------|---------|----------|
| 1 | **General Principles** | strict 必开 / `any` 视为技术债 / 不可变默认 / 单职责 / 文件 < 400 行 | ✅ |
| 2 | **Naming Conventions** | `camelCase` / `PascalCase` / `UPPER_SNAKE_CASE` 常量 / 文件 `kebab-case.ts` / React 组件 `PascalCase.tsx` | ✅ |
| 3 | **Types & Interfaces** | 对象用 `interface`，联合/交叉用 `type` | ✅ |
| 4 | **Enums** | PascalCase 枚举 + 成员 PascalCase | ✅ |
| 5 | **Variables & Constants** | 模块常量 `UPPER_SNAKE`，局部 `camelCase` | ✅ |
| 6 | **Functions** | 显式返回类型 / 参数不可变 | ✅ |
| 7 | **Classes** | 私有字段无 `_` 前缀 / `readonly` 字段 | ✅ |
| 8 | **Modules & Imports** | 默认不 namespace / 用 ES modules | ✅ |
| 9 | **Generics** | 单字母 `T` 或描述性 `TKey` | ✅ |
| 10 | **Error Handling** | 自定义 Error 子类 | ✅ |
| 11 | **Async / Await** | `async` 函数返回 `Promise<T>` | ✅ |
| 12 | **Comments & Documentation** | JSDoc 公开 API | 部分 |
| 13 | **Formatting & Style** | Prettier 风格 | ✅ |
| 14 | **Null & Undefined** | `?` 可选 + `??` 空合 | ✅ |
| 15 | **Type Assertions** | 少用 `as`，多用 `type guard` | ✅ |
| 16 | **React & JSX** | FC 不写 / props interface 显式 | ✅ |
| 17 | **Testing Conventions** | `*.test.ts` / `*.spec.ts` | ✅ |
| 18 | **Tooling & Configuration** | strict + noUncheckedIndexedAccess + exactOptionalPropertyTypes | ✅ |

### 2.1 项目重点应用规则

#### 命名规则（项目严格遵循）

```typescript
// ✅ 变量 / 函数
const getUserName = () => { ... }
const isLoading = true

// ✅ 模块常量
const MAX_RETRY_COUNT = 3
const API_BASE_URL = 'https://api.tdsf.com'

// ✅ 类 / 接口
class SshConnectionManager { ... }
interface ChatMessage { ... }

// ✅ 枚举
enum LogLevel { Debug, Info, Warn, Error }
enum ConnState { Disconnected, Connecting, Connected }

// ❌ 反例
interface IUser { ... }        // 不要 I 前缀
type UserType = { ... }        // 不要 Type/Interface 后缀
```

#### 类型 vs 接口

```typescript
// ✅ 对象形状用 interface（可扩展）
interface User {
  readonly id: string
  name: string
  email: string
}

// ✅ 联合 / 交叉 / 映射用 type
type Status = 'active' | 'inactive' | 'suspended'
type Result<T> = Success<T> | Failure
```

---

## 3. 项目 TS 实战铁律

### 3.1 双 tsconfig 配置（electron-vite 标准）

```
tsconfig.json          ← 根，引用下面两个
tsconfig.node.json     ← 主进程 + 预加载
tsconfig.web.json      ← 渲染层
```

**关键 `tsconfig.web.json`**：

```json
{
  "include": [
    "src/renderer/src/**/*",
    "src/shared/**/*",     // 跨进程类型
    "src/preload/electron.d.ts"  // window.electronAPI 类型
  ],
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true
  }
}
```

**关键 `tsconfig.node.json`**：

```json
{
  "include": [
    "src/main/**/*",
    "src/preload/**/*",
    "src/shared/**/*"
  ],
  "compilerOptions": {
    "module": "ESNext",
    "moduleResolution": "Bundler"
  }
}
```

### 3.2 类型同步铁律

| 跨边界 | 类型放哪 | 原因 |
|--------|---------|------|
| 主进程 ↔ 渲染层 | `src/shared/` | 两边 tsconfig 都 include |
| React 组件私有类型 | `src/renderer/src/components/xxx/types.ts` | 仅渲染层用 |
| 主进程服务内部 | `src/main/services/xxx/types.ts` | 仅主进程用 |

**反模式**：把 `deploy-types` 放 `src/main/services/deploy/types.ts` → 渲染层 `import type from '../../../main/...'` 触发 `TS2307: Cannot find module`。

**修复**：移到 `src/shared/deploy-types.ts`，主进程改为 `export * from '../../../shared/deploy-types'` 兼容层。

### 3.3 electron.d.ts 模式

```typescript
// src/preload/electron.d.ts
import type { ElectronAPI } from './api'

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}

export {}
```

**4 步同步**（缺一步类型必崩）：
1. `src/preload/api.ts` 定义 `ElectronAPI` interface
2. `src/preload/index.ts` 暴露 `contextBridge.exposeInMainWorld('electronAPI', ...)`
3. `src/preload/electron.d.ts` 声明 `window.electronAPI`
4. `tsconfig.web.json` include `electron.d.ts`

---

## 4. 常见 TS 错误速查（项目实战）

| 错误代码 | 含义 | 项目常见场景 | 修复 |
|----------|------|--------------|------|
| TS2304 | 找不到名字 | 漏 import / IPC handler 未注册 | 检查 import + ipc/index.ts |
| TS2307 | 找不到模块 | 跨进程类型放错位置 | 移到 `src/shared/` |
| TS2345 | 参数类型不匹配 | `satisfies` 用于 EventEmitter payload | 移除 `satisfies`，依赖 emit 签名 |
| TS2552 | 找不到名称 | `registerXxxIpcHandlers` 未 import | 在 ipc/index.ts 加 import |
| TS7006 | 隐式 any | 函数参数无类型 | 显式标注 `typeof import('xxx')` |
| TS2322 | 类型不分配 | React props 不匹配 | 检查 interface / 检查 null |
| TS2532 | 对象可能 undefined | `noUncheckedIndexedAccess` 严格模式 | 加 `if (!arr[i]) return` |
| TS2741 | 属性缺失 | interface 字段忘填 | 补字段或加 `?` |

### 4.1 高频修复模板

**TS2345 + EventEmitter + satisfies**：
```typescript
// ❌ 错
this.events.emit({ type: 'loop:step', state } satisfies LoopEngineeringEvent)

// ✅ 对（依赖 emit 签名自动注入 type）
this.events.emit('loop:step', { state })
```

**TS7006 + Monaco**：
```typescript
// ❌ 错
onMount={(editor, monaco) => { ... }}

// ✅ 对
onMount={(editor: editor.IStandaloneCodeEditor, monaco: typeof import('monaco-editor')) => { ... }}
```

**TS2322 + React props**：
```typescript
// ❌ 错
<Button title="x" />  // Button 定义 title?: string，传入必填

// ✅ 对
<Button title="x" />  // 改为 title?: string
```

---

## 5. 项目已踩 TS 坑

| 踩坑 | 版本 | 根因 | 修复 |
|------|------|------|------|
| Monaco `onMount` 隐式 any | v0.3 | 参数未标注 | 显式 `typeof import('monaco-editor')` |
| `satisfies` 用于 EventEmitter 报 TS2345 | v0.9.5 | 缺 type 字段 | 移除 `satisfies`，依赖 emit 签名 |
| esbuild 误解析 `: ReturnType =>` 为双箭头 | v0.7 | 漏冒号 | `): ReturnType =>` 单冒号 |
| 跨进程类型放主进程触发 TS2307 | v0.4 | tsconfig.web 找不到 | 移到 `src/shared/` |
| tsx 测试不解析 `@main/*` 路径别名 | v0.6 | 默认 tsconfig | `--tsconfig tsconfig.node.json` |
| `class SidecarManager` 不可 import | v1.0 | 漏 export 关键字 | 加 `export class` |

---

## 6. 高级类型（typescript-advanced-types 可选）

> **路径**：`c:\Users\Lenovo\.trae-cn\skills\typescript-advanced-types\`（如未装）

| 类型 | 用途 | 项目应用 |
|------|------|----------|
| 泛型（Generics） | 类型参数化 | `Promise<Result<T>>` / `Array<T>` |
| 条件类型（Conditional） | `T extends U ? X : Y` | `Extract<Event, { type: T }>` |
| 映射类型（Mapped） | `[K in keyof T]` | `Partial<T>` / `Readonly<T>` |
| 模板字面量（Template Literal） | `` `${T}-${U}` `` | IPC 通道名 |
| Utility Types | 内置工具 | `Omit<T, K>` / `Pick<T, K>` / `Required<T>` |

### 6.1 项目中典型使用

```typescript
// 事件类型提取
type LoopEvent = Extract<LoopEngineeringEvent, { type: 'loop:step' }>

// 排除字段
type SshResult = Omit<RawResult, 'internal'>

// IPC 通道名（模板字面量）
type IpcChannel<T extends string> = `ssh:${T}`

// 类型守卫
function isError(e: unknown): e is Error {
  return e instanceof Error
}
```

---

## 7. 最佳实践清单

1. **strict 必开**（`strict: true` + `noUncheckedIndexedAccess`）
2. **对象用 `interface`，联合用 `type`**
3. **常量用 `as const` / `readonly`**
4. **`any` 视为技术债**，尽量用 `unknown` + type guard
5. **跨进程类型放 `src/shared/`**
6. **新 IPC 通道 4 步同步**（详见 01-electron §3）
7. **public API 写 JSDoc**
8. **ESLint `@typescript-eslint/no-explicit-any` 警告视为错误**
9. **不写 `as any`，写 `as unknown as T` 至少 2 步**
10. **`as const` 优于枚举**（更轻量）

---

## 8. 推荐阅读顺序

1. `c:\Users\Lenovo\.trae-cn\skills\typescript\SKILL.md` §1-2（原则 + 命名）
2. 同文件 §3-9（类型 / 接口 / 类 / 模块）
3. 项目 `tsconfig.node.json` / `tsconfig.web.json` 理解双配置
4. [TypeScript 官方 HandBook](https://www.typescriptlang.org/docs/handbook/intro.html)（深读）

---

## 9. 引用文档

- `c:\Users\Lenovo\.trae-cn\skills\typescript\SKILL.md` — 18 章规范
- `c:\Users\Lenovo\.trae-cn\skills\typescript-advanced-types\`（如装） — 高级类型
- `d:\ai\linux教学一体\tdsf-linux-desktop\AGENTS.md` v8.4 — TS 规约
- `d:\ai\linux教学一体\tdsf-linux-desktop\DEV_SKILLS.md` v1.2 §7.2 — TS 反模式
