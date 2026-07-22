# 07 · Monaco + xterm 核心栈 Skill 调研

> **项目版本**：Monaco Editor 0.56.0 + @monaco-editor/react 4.7.0 + @xterm/xterm 5.5.0 + xterm addons
> **核心定位**：代码编辑器 + 终端（IDE 工作台核心组件）
> **最后更新**：2026-07-22

---

## 1. 核心 Skill 速查

| Skill | 评级 | 来源 | 触发词 | 核心价值 |
|-------|------|------|--------|----------|
| `monaco-editor` 官方文档 | ⭐⭐⭐必装 | microsoft.github.io/monaco-editor | "Monaco" / "代码编辑器" / "语言服务" | 完整 API + Worker |
| `xterm.js` 官方文档 | ⭐⭐⭐必装 | xtermjs.org | "xterm" / "终端" / "WebGL" | 终端 API + addon |
| `vercel-react-best-practices` §Bundle | ⭐⭐推荐 | Vercel | "bundle-dynamic-imports" | Monaco lazy load |

> **说明**：Monaco / xterm 没有专门的 Skill，靠官方文档和实战经验。

---

## 2. Monaco Editor 集成

### 2.1 项目硬约束

> **来源**：`project_memory.md`
> - IDE 编辑器**必须用 `@monaco-editor/react`**，不用 CodeMirror（VS Code 同源体验）
> - 远程路径作为唯一 ID（同时用于 Tree key 和 Tab key）

### 2.2 基础用法

```typescript
import Editor, { type OnMount, type OnChange, loader } from '@monaco-editor/react'
import { useRef } from 'react'

interface CodeEditorProps {
  value: string
  language?: string  // 'javascript' | 'typescript' | 'python' | 'bash' | 'json' | ...
  path?: string      // 用于保存 model
  readOnly?: boolean
  onChange?: (value: string) => void
}

export function CodeEditor({ value, language = 'plaintext', path, readOnly, onChange }: CodeEditorProps) {
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null)

  const handleMount: OnMount = (editor, monaco) => {
    editorRef.current = editor
    // 自定义配置
    editor.updateOptions({
      fontSize: 13,
      fontFamily: 'JetBrains Mono, monospace',
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      tabSize: 2
    })
  }

  return (
    <Editor
      height="100%"
      value={value}
      language={language}
      path={path}
      theme="vs-dark"
      onMount={handleMount}
      onChange={(v) => onChange?.(v ?? '')}
      options={{ readOnly }}
    />
  )
}
```

### 2.3 TypeScript 显式标注（项目踩坑点）

```typescript
// ❌ 错（隐式 any）
const handleMount = (editor, monaco) => { ... }

// ✅ 对（显式标注）
import type { editor } from 'monaco-editor'

const handleMount: OnMount = (
  editor: editor.IStandaloneCodeEditor,
  monaco: typeof import('monaco-editor')
) => { ... }
```

> **根因**：TS strict + esbuild 解析 `monaco` 模块默认 any，需显式 `typeof import('monaco-editor')`。

---

## 3. Monaco 性能优化（项目重点）

### 3.1 Lazy Load（最关键）

```typescript
// ❌ 错：直接 import 拖累首屏
import Editor from '@monaco-editor/react'

// ✅ 对：lazy + Suspense
import { lazy, Suspense } from 'react'
const Editor = lazy(() => import('@monaco-editor/react'))

<Suspense fallback={<EditorSkeleton />}>
  <Editor ... />
</Suspense>
```

**收益**：Monaco chunk ~50MB，首屏不加载。

### 3.2 配置 CDN Worker（避免 Electron 打包超大）

```typescript
// 配置 MonacoEnvironment 让 worker 走 CDN
self.MonacoEnvironment = {
  getWorker(_, label) {
    if (label === 'json') return new Worker('/monaco-json.worker.bundle.js')
    if (label === 'css' || label === 'scss' || label === 'less') return new Worker('/monaco-css.worker.bundle.js')
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new Worker('/monaco-html.worker.bundle.js')
    if (label === 'typescript' || label === 'javascript') return new Worker('/monaco-ts.worker.bundle.js')
    return new Worker('/monaco-editor.worker.bundle.js')
  }
}
```

**项目方案**：v1.0 走本地 worker（Electron 路径），v1.5+ 评估 CDN 模式。

### 3.3 大文件优化

```typescript
editor.updateOptions({
  // 关闭 minimap（小文件可以，大文件性能）
  minimap: { enabled: false },
  // 关闭自动布局
  automaticLayout: false,
  // 大文件只渲染可见行
  'semanticHighlighting.enabled': false
})
```

### 3.4 多编辑器共享 Model

```typescript
// 用 path 作为 model key，多 Tab 共享同一文件
const uri = monaco.Uri.parse(`file://${path}`)
let model = monaco.editor.getModel(uri)
if (!model) {
  model = monaco.editor.createModel(value, language, uri)
}
editor.setModel(model)
```

---

## 4. Monaco 多语言支持

### 4.1 内置语言

```typescript
import 'monaco-editor/esm/vs/basic-languages/bash/bash.contribution'
import 'monaco-editor/esm/vs/basic-languages/python/python.contribution'
import 'monaco-editor/esm/vs/basic-languages/typescript/typescript.contribution'
import 'monaco-editor/esm/vs/basic-languages/json/json.contribution'
```

### 4.2 主题定制

```typescript
// 自定义 dark 主题（与项目色板联动）
monaco.editor.defineTheme('tdsf-dark', {
  base: 'vs-dark',
  inherit: true,
  rules: [],
  colors: {
    'editor.background': '#0a0a0a',
    'editor.foreground': '#e4e4e7',
    'editorCursor.foreground': '#4f46e5',
    'editor.lineHighlightBackground': '#18181b',
    'editorLineNumber.foreground': '#52525b',
    'editor.selectionBackground': '#4f46e533'
  }
})

monaco.editor.setTheme('tdsf-dark')
```

---

## 5. xterm.js 集成（终端）

### 5.1 基础用法

```typescript
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { SearchAddon } from '@xterm/addon-search'
import { WebglAddon } from '@xterm/addon-webgl'
import '@xterm/xterm/css/xterm.css'

interface TerminalProps {
  id: string  // 用于复用 Terminal 实例
  onData?: (data: string) => void
}

export function XTerminal({ id, onData }: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)

  useEffect(() => {
    if (!containerRef.current) return

    const term = new Terminal({
      fontSize: 13,
      fontFamily: 'JetBrains Mono, monospace',
      theme: {
        background: '#0a0a0a',
        foreground: '#e4e4e7',
        cursor: '#4f46e5',
        black: '#000000',
        red: '#ef4444',
        green: '#22c55e',
        yellow: '#eab308',
        blue: '#3b82f6',
        magenta: '#a855f7',
        cyan: '#06b6d4',
        white: '#e4e4e7'
      },
      cursorBlink: true,
      convertEol: true,
      allowProposedApi: true
    })

    const fit = new FitAddon()
    term.loadAddon(fit)
    term.loadAddon(new WebLinksAddon())
    term.loadAddon(new SearchAddon())
    term.loadAddon(new WebglAddon())  // 性能提升

    term.open(containerRef.current)
    fit.fit()

    term.onData((data) => onData?.(data))

    termRef.current = term

    return () => {
      term.dispose()
    }
  }, [id])

  return <div ref={containerRef} className="h-full w-full" />
}
```

### 5.2 xterm + ssh2 集成

```typescript
// xterm 输入 → ssh2 → 输出
const onData = (data: string) => {
  sshClient.write(data)
}

// ssh2 输出 → xterm
sshClient.on('data', (data: Buffer) => {
  term.write(data.toString('utf-8'))
})
```

---

## 6. xterm 性能优化

### 6.1 WebGL 渲染（关键）

```typescript
// ✅ 启用 WebGL 渲染（性能提升 10x）
import { WebglAddon } from '@xterm/addon-webgl'
term.loadAddon(new WebglAddon())
```

### 6.2 Fit 处理（容器变化时）

```typescript
const fit = new FitAddon()
term.loadAddon(fit)

const observer = new ResizeObserver(() => {
  fit.fit()  // 容器变化时重新 fit
})
observer.observe(containerRef.current!)
```

### 6.3 ANSI 颜色

```typescript
// xterm 支持 ANSI 16/256/24bit 颜色
term.write('\x1b[32mgreen text\x1b[0m\n')
term.write('\x1b[38;2;255;100;50mtrue color\x1b[0m\n')
```

---

## 7. Monaco + xterm 配合设计

### 7.1 布局模式

```
┌─────────────────────────────────────┐
│  Tab 1 │ Tab 2 │ + │   ← TabBar     │
├─────────────────────────────────────┤
│                                      │
│  Monaco Editor                       │
│  (代码编辑)                          │
│                                      │
├─────────────────────────────────────┤
│  xterm Terminal                      │  ← 可拖拽分屏
│  (终端输出)                          │
└─────────────────────────────────────┘
```

### 7.2 拖拽分屏（react-resizable-panels）

```typescript
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'

<PanelGroup direction="vertical">
  <Panel defaultSize={70}>
    <CodeEditor ... />
  </Panel>
  <PanelResizeHandle />
  <Panel defaultSize={30}>
    <XTerminal ... />
  </Panel>
</PanelGroup>
```

---

## 8. 项目实战最佳实践

### 8.1 IDE 工作台架构

```
src/renderer/src/components/workbench/
├── EditorArea.tsx           ← Tab + 编辑器容器
├── tabs/
│   ├── TabBar.tsx
│   ├── TabItem.tsx
│   └── useTabs.ts          ← 标签状态（Zustand）
├── editor/
│   ├── CodeEditor.tsx
│   ├── EditorToolbar.tsx
│   └── languageConfig.ts
├── terminal/
│   ├── XTerminal.tsx
│   ├── TerminalTabs.tsx
│   └── useTerminal.ts      ← 终端状态（Zustand）
└── Sidebar/
    └── FileTree.tsx        ← 文件树
```

### 8.2 远程文件编辑流程

```
[1] Sidebar 点击文件
    → FileTree.onFileClick(path)
    → tabs.openTab(path)   // Zustand
[2] tabs.openTab
    → IPC: ssh:readFile(path)
    → set content in CodeEditor
[3] CodeEditor.onChange(value)
    → set dirty state in tabs
[4] 用户 Cmd+S
    → IPC: ssh:writeFile(path, value)
    → set clean state
```

### 8.3 SSH 会话复用

```typescript
// 一个 SSH 连接 → 多个终端 / 编辑器
class SshSessionManager {
  private sessions = new Map<connId, SshClient>()
  
  getOrCreate(connId: string): SshClient {
    if (!this.sessions.has(connId)) {
      this.sessions.set(connId, new SshClient(connId))
    }
    return this.sessions.get(connId)!
  }
}
```

---

## 9. 常见错误速查

| 错误 | 根因 | 修复 |
|------|------|------|
| `monaco` 隐式 any | TS strict | 显式 `typeof import('monaco-editor')` |
| Monaco 不显示 | worker 路径错 | 配 `MonacoEnvironment` |
| xterm 白屏 | CSS 没 import | 加 `import '@xterm/xterm/css/xterm.css'` |
| xterm 性能差 | 没用 WebGL | 加 `WebglAddon` |
| Monaco 拖拽卡 | 文件太大 | 关 `minimap` + `semanticHighlighting` |
| 多 Tab 编辑器冲突 | model 共享错 | 用 path 作 URI key |
| xterm 容器变化后错位 | 没 fit | 加 `ResizeObserver` |
| 终端乱码 | encoding 错 | `Buffer.toString('utf-8')` |

---

## 10. 性能优化清单

### 10.1 Monaco

1. **lazy + Suspense**（必做，~50MB）
2. 关闭 minimap（大文件）
3. 关闭 semantic highlighting（大文件）
4. 共享 model（多 Tab 同一文件）
5. 关闭 `automaticLayout`（手动控制）
6. 用 `requestAnimationFrame` 节流 onChange

### 10.2 xterm

1. **WebGL renderer**（必做，10x 提升）
2. `ResizeObserver` 自动 fit
3. 多 terminal 共享 ssh 连接
4. dispose 时清理
5. 大输出用 `write` 而非 `writeln` 拼接

---

## 11. 最佳实践清单

1. **Monaco 用 `@monaco-editor/react`**，不用 CodeMirror
2. **lazy load Monaco**（Suspense）
3. **远程路径作 model URI**（共享 model）
4. **xterm 用 WebGL renderer**
5. **xterm CSS 必须 import**
6. **TS 显式标注 monaco 类型**
7. **不每键触发 IPC**（debounce 编辑）
8. **dispose 时清理 terminal**
9. **SSH 连接复用**（多终端共享）
10. **颜色与 Tailwind 变量联动**

---

## 12. 推荐阅读顺序

1. [Monaco Editor 官方](https://microsoft.github.io/monaco-editor/)（API）
2. [@monaco-editor/react](https://github.com/suren-atoyan/monaco-react)（React 包装）
3. [xterm.js 官方](https://xtermjs.org/)（API）
4. [xterm-addon-webgl](https://github.com/xtermjs/xterm.js/tree/master/addons/addon-webgl)（性能）
5. 项目 `src/renderer/src/components/workbench/` 实际组件

---

## 13. 引用文档

- [microsoft.github.io/monaco-editor](https://microsoft.github.io/monaco-editor/) — Monaco 官方
- [xtermjs.org](https://xtermjs.org/) — xterm 官方
- `c:\Users\Lenovo\.trae-cn\skills\vercel-react-best-practices\rules\bundle-dynamic-imports.md` — lazy load
- `d:\ai\linux教学一体\tdsf-linux-desktop\AGENTS.md` v8.4 — IDE 规约
- `d:\ai\linux教学一体\tdsf-linux-desktop\project_memory.md` — Monaco 硬约束
