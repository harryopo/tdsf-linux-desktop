/**
 * 应用更新 IPC Handlers（v2.2 P1 修复 #24：AboutSettings 检查更新功能）
 *
 * 暴露给渲染进程的更新检查能力：
 * - app:check-update    — HTTP GET GitHub Releases API 比对版本号
 * - app:download-update — 打开浏览器到 Release 页面（简化方案，不引入 electron-updater）
 *
 * 设计说明（简化方案 · CLAUDE.md A7 质量优先 + A8 避免重复造轮子）：
 * - 不引入 electron-updater（避免 publisher 配置复杂 + GitHub Token 管理）
 * - 用 Node.js 内置 fetch（Electron 43 / Node 20+ 支持）请求 GitHub Releases API
 * - 比对 semver 版本号（去 v 前缀后逐段比较）
 * - "下载更新" 用 shell.openExternal 打开浏览器到 Release 页面，由用户手动下载安装
 *
 * 安全：
 * - catch 块错误信息经 redactSecrets 脱敏（A3 红线）
 * - GitHub API 速率限制：未认证 60 次/小时/IP（个人使用足够）
 * - 不发送任何用户隐私信息到 GitHub（仅 GET 公开 Release）
 */
import { ipcMain, shell } from 'electron'
import { APP } from '@shared/ipc-channels'
import { logger } from '../services/log/logger'
import { redactSecrets } from '../core/agent/providers/redact'

/**
 * GitHub 仓库标识（与 about-settings.constants.ts LINK_URLS.github 对齐）
 *
 * 格式：owner/repo，用于构造 GitHub Releases API URL
 */
const GITHUB_REPO = 'tdsf-linux/tdsf-linux-desktop'

/**
 * GitHub Releases API URL（latest release 端点）
 *
 * 返回最新的 Release 对象（含 tag_name / name / body / html_url / published_at）
 * 文档：https://docs.github.com/en/rest/releases/releases#get-the-latest-release
 */
const GITHUB_LATEST_RELEASE_API = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`

/**
 * GitHub Releases 页面 URL（用于"前往下载"按钮打开浏览器）
 */
const GITHUB_RELEASES_PAGE = `https://github.com/${GITHUB_REPO}/releases`

/**
 * 应用更新信息（返回给渲染进程）
 */
export interface AppUpdateInfo {
  /** 是否有新版本 */
  hasUpdate: boolean
  /** 最新版本号（含 v 前缀，如 'v1.0.1'） */
  latestVersion: string
  /** 当前版本号（含 v 前缀，如 'v1.0.0'） */
  currentVersion: string
  /** Release 页面 URL（用户可手动下载） */
  releaseUrl: string
  /** 更新日志（Markdown 格式，来自 Release body） */
  releaseNotes: string
  /** Release 发布时间（ISO 8601 字符串） */
  publishedAt: string
}

/**
 * 应用更新错误信息（返回给渲染进程，已脱敏）
 */
export interface AppUpdateError {
  /** 是否有新版本（出错时为 false） */
  hasUpdate: false
  /** 错误信息（已脱敏） */
  error: string
}

/** GitHub Release API 响应体（仅取需要的字段） */
interface GitHubReleaseResponse {
  tag_name: string
  name: string | null
  body: string | null
  html_url: string
  published_at: string
}

/**
 * 比较两个语义化版本号
 *
 * @param current 当前版本（如 '1.0.0' 或 'v1.0.0'）
 * @param latest  最新版本（如 '1.0.1' 或 'v1.0.1'）
 * @returns true 表示 latest > current（有更新），false 表示无更新或解析失败
 */
function isNewerVersion(current: string, latest: string): boolean {
  // 去 v 前缀 + trim
  const normalize = (v: string): string => v.trim().replace(/^v/i, '')
  const currentParts = normalize(current).split('.').map((p) => Number.parseInt(p, 10))
  const latestParts = normalize(latest).split('.').map((p) => Number.parseInt(p, 10))
  // 长度对齐（用 0 补齐）
  const maxLen = Math.max(currentParts.length, latestParts.length)
  for (let i = 0; i < maxLen; i++) {
    const c = currentParts[i] ?? 0
    const l = latestParts[i] ?? 0
    if (Number.isNaN(c) || Number.isNaN(l)) return false
    if (l > c) return true
    if (l < c) return false
  }
  return false
}

/**
 * 从 app.getVersion() 获取当前版本号
 *
 * Electron app.getVersion() 返回 package.json version（无 v 前缀），
 * 统一加 v 前缀便于 UI 展示。
 */
function getCurrentVersion(): string {
  // 延迟导入避免循环依赖（app 在模块加载时可能未初始化）
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { app } = require('electron')
  const v = app.getVersion()
  return v.startsWith('v') ? v : `v${v}`
}

/** 注册应用更新 IPC handlers（无需 mainWindow） */
export function registerAppUpdateHandlers(): void {
  /**
   * app:check-update — 检查 GitHub Releases 是否有新版本
   *
   * 流程：
   * 1. 获取当前版本（app.getVersion）
   * 2. HTTP GET GitHub Releases API
   * 3. 比对版本号
   * 4. 返回 AppUpdateInfo（含 releaseNotes / releaseUrl）
   *
   * 错误处理：
   * - 网络失败：返回 AppUpdateError（已脱敏）
   * - GitHub API 速率限制（403）：返回 AppUpdateError（提示稍后重试）
   * - 解析失败：返回 AppUpdateError
   */
  ipcMain.handle(APP.CHECK_UPDATE, async (): Promise<AppUpdateInfo | AppUpdateError> => {
    const currentVersion = getCurrentVersion()
    try {
      logger.info('APP_UPDATE', '检查更新开始', { currentVersion })

      const response = await fetch(GITHUB_LATEST_RELEASE_API, {
        method: 'GET',
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'TDSF-Linux-Desktop-Update-Checker',
        },
        // 10 秒超时（避免网络卡死 UI）
        signal: AbortSignal.timeout(10_000),
      })

      if (!response.ok) {
        const errorMsg = `GitHub API 响应错误: HTTP ${response.status}`
        logger.warn('APP_UPDATE', errorMsg, { status: response.status })
        return {
          hasUpdate: false,
          error: response.status === 403
            ? 'GitHub API 速率限制（每小时 60 次），请稍后重试'
            : errorMsg,
        }
      }

      const release = (await response.json()) as GitHubReleaseResponse
      const latestVersion = release.tag_name // 通常含 v 前缀，如 'v1.0.1'
      const hasUpdate = isNewerVersion(currentVersion, latestVersion)

      logger.info('APP_UPDATE', '检查更新完成', {
        currentVersion,
        latestVersion,
        hasUpdate,
      })

      return {
        hasUpdate,
        latestVersion,
        currentVersion,
        releaseUrl: release.html_url,
        releaseNotes: release.body ?? '暂无更新日志',
        publishedAt: release.published_at,
      }
    } catch (err) {
      const rawMessage = err instanceof Error ? err.message : String(err)
      const safeMessage = redactSecrets(rawMessage)
      logger.error('APP_UPDATE', '检查更新失败', { error: safeMessage })
      return {
        hasUpdate: false,
        error: safeMessage,
      }
    }
  })

  /**
   * app:download-update — 打开浏览器到 Release 页面
   *
   * 简化方案：不实现自动下载安装（避免 electron-updater 复杂配置 + publisher 证书），
   * 让用户在浏览器中手动下载 .exe/.dmg/.AppImage 安装包。
   *
   * 参数：
   * - 无参数：打开 Releases 列表页面
   * - releaseUrl：指定 Release URL（来自 check-update 返回值），直接打开该版本
   */
  ipcMain.handle(
    APP.DOWNLOAD_UPDATE,
    async (_event, releaseUrl?: string): Promise<boolean> => {
      const url = releaseUrl || GITHUB_RELEASES_PAGE
      try {
        logger.info('APP_UPDATE', '打开下载页面', { url })
        await shell.openExternal(url)
        return true
      } catch (err) {
        const rawMessage = err instanceof Error ? err.message : String(err)
        const safeMessage = redactSecrets(rawMessage)
        logger.error('APP_UPDATE', '打开下载页面失败', { error: safeMessage, url })
        throw new Error(`打开下载页面失败: ${safeMessage}`)
      }
    }
  )
}
