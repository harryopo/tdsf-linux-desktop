# 08 · 状态管理 + 持久化核心栈 Skill 调研

> **项目版本**：Zustand 4.5.0 + Dexie 4.4.4 + better-sqlite3 13.0.1 + electron-store 8.2.0 + @photostructure/sqlite-vec 1.2.0 + zod 3.25
> **核心定位**：状态管理（内存） + 持久化（磁盘） + Schema 校验
> **最后更新**：2026-07-22

---

## 1. 核心 Skill 速查

| Skill | 评级 | 来源 | 触发词 | 核心价值 |
|-------|------|------|--------|----------|
| `zustand-patterns` | ⭐⭐⭐必装 | 社区（14 模块生产经验） | "Zustand" / "Store 设计" / "persist" | 完整模式 + 反模式 |
| `sqlite` | ⭐⭐⭐必装 | clawdbot 社区 | "SQLite" / "better-sqlite3" / "WAL" | 9 大主题避坑 |
| `react-state-management` | ⭐推荐 | 社区 | "状态管理" / "Redux" / "TanStack Query" | 全景对比 |
| `vercel-react-best-practices` §async | ⭐推荐 | Vercel | "SWR" / "数据获取" | client-swr-dedup |

> **Skill 路径**：
> - `c:\Users\Lenovo\.trae-cn\skills\zustand-patterns\SKILL.md`（14 模块经验）
> - `c:\Users\Lenovo\.trae-cn\skills\sqlite\SKILL.md`（9 大主题）

---

## 2. Zustand 模式（zustand-patterns Skill · 必装）

> **来源**：`c:\Users\Lenovo\.trae-cn\skills\zustand-patterns\SKILL.md`
> **项目价值**：14 个模块共用的生产级经验

### 2.1 Store 设计规范

#### 一个模块一个 Store

```typescript
// ✅ 每个功能模块独立 Store
src/renderer/src/store/chatStore.ts        → useChatStore
src/renderer/src/store/settingsStore.ts    → useSettingsStore
src/renderer/src/store/sshStore.ts         → useSshStore
src/renderer/src/store/knowledgeStore.ts   → useKnowledgeStore
src/renderer/src/store/agentStore.ts       → useAgentStore

// ❌ 反例：全局大 Store
src/renderer/src/store/globalStore.ts      → useGlobalStore
```

#### Store 命名

```typescript
// Hook 导出用 use 前缀 + 模块名 + Store
export const useChatStore = create<ChatStore>()((set) => ({ ... }))

// 文件名：{moduleName}Store.ts
```

#### Store 接口先行

```typescript
// ✅ 先定义接口
interface ChatStore {
  // — 状态 —
  messages: Message[]
  input: string
  isLoading: boolean

  // — Actions —
  setInput: (s: string) => void
  send: () => Promise<void>
  reset: () => void
}

// 再实现
export const useChatStore = create<ChatStore>()((set, get) => ({
  messages: [],
  input: '',
  isLoading: false,
  setInput: (s) => set({ input: s }),
  send: async () => {
    set({ isLoading: true })
    // ...
    set({ isLoading: false })
  },
  reset: () => set({ messages: [], input: '' })
}))
```

### 2.2 Slice 模式（多 Store 复用）

```typescript
// store/ssh/types.ts
export interface SshBaseState {
  connId: string | null
  status: 'disconnected' | 'connecting' | 'connected'
  error: string | null
}

export interface SshBaseActions {
  connect: (config: SshConfig) => Promise<void>
  disconnect: () => Promise<void>
  reset: () => void
}

// store/ssh/sshStore.ts
import { create } from 'zustand'
import { devtools } from 'zustand/middleware'

export const useSshStore = create<SshBaseState & SshBaseActions>()(
  devtools(
    (set, get) => ({
      connId: null,
      status: 'disconnected',
      error: null,
      connect: async (config) => {
        set({ status: 'connecting' })
        try {
          const connId = await window.electronAPI.sshConnect(config)
          set({ connId, status: 'connected' })
        } catch (err) {
          set({ error: String(err), status: 'disconnected' })
        }
      },
      disconnect: async () => {
        await window.electronAPI.sshDisconnect(get().connId)
        set({ connId: null, status: 'disconnected' })
      },
      reset: () => set({ connId: null, status: 'disconnected', error: null })
    }),
    { name: 'ssh-store' }
  )
)
```

### 2.3 persist 持久化

```typescript
import { persist, createJSONStorage } from 'zustand/middleware'

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      theme: 'dark',
      language: 'zh-CN',
      setTheme: (theme) => set({ theme })
    }),
    {
      name: 'tdsf-settings',
      storage: createJSONStorage(() => localStorage),  // 浏览器侧
      partialize: (state) => ({ theme: state.theme, language: state.language })  // 只持久化必要字段
    }
  )
)
```

> **坑**：localStorage 不能存函数 / Symbol / Date，需 `partialize` + 序列化中间件。

### 2.4 Electron 主进程 ↔ Store 联动

```typescript
// 渲染层 Store
useChatStore.subscribe(
  (state) => state.messages,
  (messages) => {
    // 通过 IPC 同步到主进程持久化
    window.electronAPI.persistMessages(messages)
  }
)

// 主进程持久化（better-sqlite3）
ipcMain.handle('persist:messages', async (_, messages) => {
  db.prepare('INSERT OR REPLACE INTO messages ...').run(messages)
})
```

### 2.5 可恢复任务

```typescript
// 任务失败后保留状态，重启后恢复
export const useTaskStore = create<TaskStore>()(
  persist(
    (set, get) => ({
      tasks: [],
      addTask: (task) => set((s) => ({ tasks: [...s.tasks, task] })),
      updateTask: (id, patch) => set((s) => ({
        tasks: s.tasks.map((t) => t.id === id ? { ...t, ...patch } : t)
      }))
    }),
    {
      name: 'tasks',
      storage: createJSONStorage(() => localStorage)
    }
  )
)
```

### 2.6 Store 测试

```typescript
import { renderHook, act } from '@testing-library/react'
import { useChatStore } from './chatStore'

test('send appends message', async () => {
  const { result } = renderHook(() => useChatStore())
  await act(async () => {
    await result.current.send('hello')
  })
  expect(result.current.messages).toHaveLength(1)
})
```

---

## 3. SQLite Skill（9 大主题 · 必装）

> **来源**：`c:\Users\Lenovo\.trae-cn\skills\sqlite\SKILL.md`

### 3.1 Concurrency（最大坑）

| 规则 | 项目做法 |
|------|----------|
| 一次一个 writer | ✅ 用 `db.transaction()` 串行化 |
| **WAL 模式必开** | ✅ `PRAGMA journal_mode=WAL` |
| **busy_timeout** | ✅ `PRAGMA busy_timeout=5000` |
| WAL 文件备份 | ✅ `-wal` `-shm` 一起复制 |
| `BEGIN IMMEDIATE` 早抢锁 | ✅ 写前用 `BEGIN IMMEDIATE TRANSACTION` |

### 3.2 Foreign Keys（默认关闭！）

```sql
-- 必加（每连接）
PRAGMA foreign_keys = ON;

-- 验证
PRAGMA foreign_keys;  -- 应返回 1
```

> **不开启 → 外键约束静默忽略** → 数据完整性破坏。

### 3.3 Type System（类型亲和）

| 类型 | 实际行为 |
|------|----------|
| INTEGER | 接受任意值（亲和而非严格） |
| STRICT | 严格类型（SQLite 3.37+） |
| DATE/TIME | 无原生，用 TEXT ISO8601 或 INTEGER Unix |
| BOOLEAN | 无，用 INTEGER 0/1 |
| REAL | 8 字节浮点 |

### 3.4 Schema 变更（限制大）

```sql
-- ✅ 支持
ALTER TABLE xxx ADD COLUMN yyy TEXT
ALTER TABLE xxx RENAME TO yyy
ALTER TABLE xxx RENAME COLUMN a TO b

-- ❌ 不支持（直到 SQLite 3.35）
-- 改列类型、加约束、删列
```

**Workaround**：建新表 + 复制 + 删旧 + 重命名 + 事务包裹。

### 3.5 Performance Pragmas

```sql
PRAGMA optimize;                          -- 关闭前跑，更新 query planner
PRAGMA cache_size = -64000;               -- 64MB 缓存
PRAGMA synchronous = NORMAL;              -- WAL 下安全且快
PRAGMA temp_store = MEMORY;               -- 临时表放内存
```

### 3.6 Vacuum & 维护

| 命令 | 用途 | 注意事项 |
|------|------|----------|
| `VACUUM` | 回收空间 | 需要 2x 磁盘 |
| `PRAGMA auto_vacuum = INCREMENTAL` | 增量回收 | 配合 `incremental_vacuum` |
| 批量删后 | 必跑 vacuum | 否则文件膨胀 |

### 3.7 备份安全

```sql
-- ✅ 备份
VACUUM INTO 'backup.db';  -- 3.27+

-- ❌ 错：复制时 db 开着
```

### 3.8 索引

- 覆盖索引：包含多列避免回表
- 表达式索引：`CREATE INDEX ... ON table (LOWER(col))`
- 部分索引：`CREATE INDEX ... ON table WHERE condition`

### 3.9 项目 better-sqlite3 实战

```typescript
import Database from 'better-sqlite3'

const db = new Database('tdsf.db')

// ✅ 必备 pragmas
db.pragma('journal_mode = WAL')
db.pragma('busy_timeout = 5000')
db.pragma('foreign_keys = ON')
db.pragma('synchronous = NORMAL')
db.pragma('cache_size = -64000')

// 事务
const insert = db.transaction((data) => {
  const stmt = db.prepare('INSERT INTO xxx (a, b) VALUES (?, ?)')
  for (const row of data) stmt.run(row.a, row.b)
})

// 性能：prepared statement
const stmt = db.prepare('SELECT * FROM xxx WHERE id = ?')
const user = stmt.get(id)
```

---

## 4. Zustand + SQLite 协同架构

```
┌─────────────────────────────────────────────┐
│  Renderer (React)                            │
│  ┌─────────────┐   ┌──────────────┐         │
│  │ ChatStore   │   │ SshStore     │  ...   │
│  └──────┬──────┘   └──────┬───────┘         │
│         │                 │                  │
│         └────────┬────────┘                  │
│              │ IPC                          │
└──────────────┼──────────────────────────────┘
               ↓
┌──────────────────────────────────────────────┐
│  Main Process (Node)                          │
│  ┌──────────────────────────────────┐        │
│  │ better-sqlite3                   │        │
│  │  ├─ WAL mode + foreign_keys=ON  │        │
│  │  ├─ prepared statements          │        │
│  │  └─ transactions                 │        │
│  └──────────────────────────────────┘        │
└──────────────────────────────────────────────┘
```

### 4.1 渲染层临时状态 → Zustand

- 组件 UI 状态（input / 弹窗 / loading）
- 不需要持久化的中间数据
- 多组件共享的会话状态

### 4.2 主进程持久状态 → SQLite

- 用户配置（已连接服务器 / 凭据）
- 历史记录（聊天 / 命令）
- 知识库（教程 / drain 模板）
- Agent 决策日志

### 4.3 同步策略

- Zustand persist 中间件 → localStorage（仅 UI 偏好）
- Zustand 订阅 → IPC → SQLite（业务数据）
- 关键数据双写：localStorage 快速读 + SQLite 可靠持久

---

## 5. Dexie（IndexedDB 包装）

### 5.1 项目用法（事件流存储）

```typescript
// 项目硬约束："事件流存储用 Dexie（IndexedDB），不用文件"
import Dexie, { type Table } from 'dexie'

interface ChatEvent {
  id?: number
  sessionId: string
  type: 'user' | 'assistant' | 'tool'
  content: string
  timestamp: number
}

class EventStore extends Dexie {
  events!: Table<ChatEvent, number>

  constructor() {
    super('tdsf-events')
    this.version(1).stores({
      events: '++id, sessionId, timestamp'
    })
  }
}

export const eventDb = new EventStore()

// 用法
await eventDb.events.add({
  sessionId: 's1',
  type: 'user',
  content: 'hello',
  timestamp: Date.now()
})

const events = await eventDb.events.where('sessionId').equals('s1').sortBy('timestamp')
```

### 5.2 vs SQLite 选型

| 场景 | 用 Dexie | 用 SQLite |
|------|----------|-----------|
| 浏览器内事件流 | ✅ | ❌ |
| 主进程业务数据 | ❌ | ✅ |
| 配置 / 凭据 | ❌ | ✅（用 SecureStore 加密） |
| 临时缓存 | ✅ | ❌ |

---

## 6. electron-store（配置持久化）

```typescript
import Store from 'electron-store'

interface AppConfig {
  theme: 'light' | 'dark'
  language: 'zh-CN' | 'en-US'
  recentServers: string[]
  windowBounds: { x: number; y: number; width: number; height: number }
}

const store = new Store<AppConfig>({
  name: 'tdsf-config',
  defaults: {
    theme: 'dark',
    language: 'zh-CN',
    recentServers: [],
    windowBounds: { x: 100, y: 100, width: 1280, height: 800 }
  },
  encryptionKey: '...'  // 可选加密
})

// 用法
store.set('theme', 'light')
const theme = store.get('theme')
```

---

## 7. zod（Schema 校验）

```typescript
import { z } from 'zod'

const SshConfigSchema = z.object({
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535),
  username: z.string().min(1),
  password: z.string().optional(),
  privateKey: z.string().optional()
})

// IPC handler 内
ipcMain.handle('ssh:connect', async (_, config: unknown) => {
  const parsed = SshConfigSchema.parse(config)  // 抛错 = 拒绝
  // ...
})

// 推导类型
type SshConfig = z.infer<typeof SshConfigSchema>
```

> **项目硬约束**：所有 IPC handler 必须用 zod 校验输入。

---

## 8. sqlite-vec（向量检索）

```typescript
// v1.0 知识库向量化检索
import { VectorDatabase } from '@photostructure/sqlite-vec'

// 项目用本地 embedding（@xenova/transformers）
const embedding = await embedModel.embed(text)  // 384 维向量

// 存
db.prepare('INSERT INTO vectors (text, vec) VALUES (?, ?)').run(text, vectorToBlob(embedding))

// 查
const results = db.prepare(`
  SELECT text, vec_distance_cosine(vec, ?) AS distance
  FROM vectors
  ORDER BY distance
  LIMIT 5
`).all(vectorToBlob(queryVec))
```

---

## 9. 项目已踩坑

| 踩坑 | 根因 | 修复 |
|------|------|------|
| better-sqlite3 数据库锁 | WAL 未开 | `pragma('journal_mode = WAL')` |
| Zustand state 修改不触发渲染 | 直接 mutate | 用 `set({...})` |
| IPC handler 接收 undefined | 缺 zod 校验 | 加 zod parse |
| persist 后 state 恢复失败 | 序列化函数 | `partialize` 选字段 |
| SQLite 启动慢 | 缺索引 | 加 `CREATE INDEX` |
| electron-store 加密失败 | 缺 encryptionKey | 加 key |

---

## 10. 性能优化清单

### 10.1 Zustand

1. **一个模块一个 Store**（不堆全局）
2. **select 细粒度订阅**（`useStore(s => s.x)`）
3. **actions 提到组件外**（`useStore.getState()`）
4. **`partialize` 持久化关键字段**
5. **不持久化函数 / Symbol / Date**

### 10.2 SQLite

1. **WAL 模式必开**
2. **`busy_timeout` 必设**
3. **`foreign_keys = ON` 必设**
4. **prepared statement 复用**
5. **事务批量写**
6. **覆盖索引**（查询字段全在索引里）
7. **`synchronous = NORMAL` + WAL**
8. **定期 `PRAGMA optimize`**

---

## 11. 最佳实践清单

1. **一个模块一个 Zustand Store**
2. **Store 接口先行**
3. **persist 用 `partialize`**
4. **IPC 入参必走 zod 校验**
5. **SQLite 必开 WAL + foreign_keys**
6. **事务包批量写**
7. **Dexie 仅存浏览器侧事件**
8. **electron-store 存配置**
9. **凭据用 SecureStore 加密**
10. **sqlite-vec 做本地向量检索**

---

## 12. 推荐阅读顺序

1. `c:\Users\Lenovo\.trae-cn\skills\zustand-patterns\SKILL.md`（必读，14 模块经验）
2. `c:\Users\Lenovo\.trae-cn\skills\sqlite\SKILL.md`（必读，9 主题）
3. [Zustand 官方](https://github.com/pmndrs/zustand)（按需查）
4. [better-sqlite3 文档](https://github.com/WiseLibs/better-sqlite3)（按需查）
5. 项目 `src/renderer/src/store/` 实际 store

---

## 13. 引用文档

- `c:\Users\Lenovo\.trae-cn\skills\zustand-patterns\SKILL.md` — 14 模块实战
- `c:\Users\Lenovo\.trae-cn\skills\sqlite\SKILL.md` — 9 主题
- `c:\Users\Lenovo\.trae-cn\skills\vercel-react-best-practices\SKILL.md` — 数据获取
- `d:\ai\linux教学一体\tdsf-linux-desktop\AGENTS.md` v8.4 — 状态规约
- `d:\ai\linux教学一体\tdsf-linux-desktop\DEV_SKILLS.md` v1.2 §7.2 — 反模式
