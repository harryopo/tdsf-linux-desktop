/**
 * IDE 工作台状态管理 Store（Zustand）— v0.8
 *
 * 职责：
 * - 管理已打开的文件列表（多 Tab 切换）
 * - 跟踪当前激活的文件路径
 * - 维护每个文件的编辑器内容、原始内容、未保存标识
 * - 维护远程根路径（默认 '/'）
 *
 * 设计原则：
 * - 不持久化（IDE 会话级状态，关闭即清空）
 * - 内容变更立即更新 store，与 Monaco onChange 双向绑定
 * - 脏检测：current !== original 即 dirty
 */
import { create } from 'zustand'

/** 已打开的文件元信息 */
export interface OpenedFile {
  /** 远程完整路径（唯一 ID） */
  path: string
  /** 文件名（不含目录） */
  name: string
  /** 当前编辑器内容 */
  content: string
  /** 上次保存的内容（用于脏检测） */
  originalContent: string
  /** Monaco 语言 ID（如 'shell' / 'python' / 'json'） */
  language: string
  /** 是否有未保存的修改 */
  isDirty: boolean
  /** 是否正在加载（SFTP 读取中） */
  isLoading: boolean
  /** 文件大小（字节，stat 时记录） */
  size: number
}

/** IDE Store 状态接口 */
interface IDEState {
  /** 远程根路径（默认 '/'） */
  rootPath: string
  /** 已打开文件列表（按打开顺序） */
  openFiles: OpenedFile[]
  /** 当前激活的文件 path（null 表示无激活） */
  activeFilePath: string | null

  // ===== Actions =====
  /** 设置远程根路径 */
  setRootPath: (path: string) => void
  /** 打开文件（若已打开则仅激活） */
  openFile: (file: Omit<OpenedFile, 'isDirty' | 'isLoading'>) => void
  /** 关闭文件（若关闭的是激活的，自动切换相邻 Tab） */
  closeFile: (path: string) => void
  /** 设置激活文件 */
  setActiveFile: (path: string | null) => void
  /** 更新文件内容（编辑器 onChange 触发，自动计算 dirty） */
  updateContent: (path: string, content: string) => void
  /** 标记文件已保存（重置 dirty + 同步 original） */
  markSaved: (path: string, newContent: string) => void
  /** 设置文件加载状态 */
  setLoading: (path: string, isLoading: boolean) => void
}

/**
 * 根据文件名推断 Monaco 语言 ID
 *
 * @param filename 文件名（如 'nginx.conf' / 'deploy.sh' / 'main.py'）
 * @returns Monaco language id（如 'shell' / 'python' / 'plaintext'）
 */
export function detectLanguage(filename: string): string {
  const lower = filename.toLowerCase()
  // 特殊文件名优先匹配
  if (lower === 'dockerfile') return 'dockerfile'
  if (lower === 'makefile') return 'makefile'
  if (lower === '.bashrc' || lower === '.bash_profile' || lower === '.profile')
    return 'shell'

  const ext = lower.split('.').pop() ?? ''
  const extMap: Record<string, string> = {
    sh: 'shell',
    bash: 'shell',
    zsh: 'shell',
    py: 'python',
    js: 'javascript',
    mjs: 'javascript',
    cjs: 'javascript',
    ts: 'typescript',
    jsx: 'javascript',
    tsx: 'typescript',
    json: 'json',
    yml: 'yaml',
    yaml: 'yaml',
    md: 'markdown',
    markdown: 'markdown',
    txt: 'plaintext',
    log: 'plaintext',
    conf: 'ini',
    ini: 'ini',
    cfg: 'ini',
    properties: 'ini',
    c: 'c',
    h: 'cpp',
    cpp: 'cpp',
    cc: 'cpp',
    hpp: 'cpp',
    java: 'java',
    go: 'go',
    rs: 'rust',
    rb: 'ruby',
    php: 'php',
    sql: 'sql',
    html: 'html',
    htm: 'html',
    css: 'css',
    scss: 'scss',
    less: 'less',
    xml: 'xml',
    svg: 'xml',
  }
  return extMap[ext] ?? 'plaintext'
}

/** IDE Store */
export const useIDEStore = create<IDEState>()((set, get) => ({
  rootPath: '/',
  openFiles: [],
  activeFilePath: null,

  setRootPath: (path) => set({ rootPath: path }),

  openFile: (file) =>
    set((state) => {
      // 已打开则仅激活
      const existing = state.openFiles.find((f) => f.path === file.path)
      if (existing) {
        return { activeFilePath: file.path }
      }
      // 新打开，加入列表末尾
      return {
        openFiles: [
          ...state.openFiles,
          { ...file, isDirty: false, isLoading: false },
        ],
        activeFilePath: file.path,
      }
    }),

  closeFile: (path) =>
    set((state) => {
      const idx = state.openFiles.findIndex((f) => f.path === path)
      if (idx < 0) return state
      const newFiles = state.openFiles.filter((f) => f.path !== path)
      // 关闭的是当前激活的，自动切换到相邻 Tab
      let newActive = state.activeFilePath
      if (state.activeFilePath === path) {
        if (newFiles.length === 0) {
          newActive = null
        } else if (idx >= newFiles.length) {
          newActive = newFiles[newFiles.length - 1].path
        } else {
          newActive = newFiles[idx].path
        }
      }
      return { openFiles: newFiles, activeFilePath: newActive }
    }),

  setActiveFile: (path) => set({ activeFilePath: path }),

  updateContent: (path, content) =>
    set((state) => ({
      openFiles: state.openFiles.map((f) =>
        f.path === path
          ? { ...f, content, isDirty: content !== f.originalContent }
          : f
      ),
    })),

  markSaved: (path, newContent) =>
    set((state) => ({
      openFiles: state.openFiles.map((f) =>
        f.path === path
          ? {
              ...f,
              content: newContent,
              originalContent: newContent,
              isDirty: false,
            }
          : f
      ),
    })),

  setLoading: (path, isLoading) =>
    set((state) => ({
      openFiles: state.openFiles.map((f) =>
        f.path === path ? { ...f, isLoading } : f
      ),
    })),
}))
