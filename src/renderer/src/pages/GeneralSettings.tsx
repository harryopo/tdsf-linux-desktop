/**
 * GeneralSettings — 通用（数据与存储 / 定时任务）
 *
 * 路由：/settings/general
 *
 * 这一页原来有四张卡（语言与地区 / 启动行为 / 数据与存储 / 通知，共 17 个控件），
 * 逐个查过消费者之后，只有"数据与存储"是真的：
 * - 界面语言：应用没有 i18n，选了不切换任何东西
 * - 时区/日期格式/数字格式：全仓没有任何地方按它格式化时间或数字
 * - 启动时打开（含"编辑器/终端"两个并不存在的顶层入口）/自动恢复会话/启动检查更新/后台运行：无消费者
 * - 桌面通知/声音/通知位置/勿扰时段：没有通知管线，也没有发信链路
 * - 自动清理日志/日志保留天数：没有任何按天数删日志的代码
 * 这些控件"看着能点、点了存盘、重启还在"，但改变不了程序行为，属于误导性假 UI，整块删除。
 * 真要做得先把链路接上，而不是先摆开关。
 *
 * 保留下来的两项都走真实 IPC：app:get-info（数据/日志目录）、
 * configGet 逐项导出、logClearBuffer 清缓存；定时任务由 SchedulerPanel 自包含。
 */
import { useEffect, useRef, useState } from 'react'
import { Database, Download, Loader2, Trash2 } from 'lucide-react'
import { SettingsPageHeader } from '@/components/settings/SettingsPageHeader'
import { settingsHeader } from './settings-sections'
import { SettingsCard } from '@/components/settings/SettingsCard'
import { SettingsRow } from '@/components/settings/SettingsRow'
import { SchedulerPanel } from '@/components/settings/SchedulerPanel'
import './Settings.css'

/**
 * "导出数据"要拉取的配置键清单。
 * 只列真实存在且有消费者的键；server list / llm config 走 SecureStore 加密存储，
 * 不在导出范围（避免把凭据打包带走）。
 */
const EXPORT_CONFIG_KEYS: readonly string[] = [
  'appearance.fontSize',
  'appearance.lineHeight',
  'appearance.codeFont',
  'appearance.codeTheme',
  'appearance.density',
  'general.email',
  'decision.confidenceThreshold',
  'decision.decisionTimeout',
  'decision.fileSizeLimit',
  'decision.batchLimit',
  'decision.rollbackRetention',
  'risk.auditCmdExec',
  'risk.auditFileMod',
  'risk.auditAiDecision',
  'risk.auditSshConn',
  'risk.auditRetention',
  'terminal.shell',
  'terminal.fontSize',
  'terminal.fontFamily',
  'terminal.lineHeight',
  'terminal.cursorStyle',
  'terminal.cursorBlink',
  'terminal.scrollback',
  'terminal.autoCopy',
  'terminal.rightClickPaste',
  'terminal.stripNewline',
  'terminal.stripControlChars',
  'terminal.bellEnabled',
  'terminal.mouseSupport',
  'terminal.webglRenderer',
  'terminal.sshHeartbeat',
  'terminal.cmdTimeout',
  'monthlyBudget',
  'alertThreshold',
]

/** 只读路径展示框 */
function ReadOnlyPath({ value, loading }: { value: string; loading?: boolean }) {
  return (
    <div className="set-input set-input--readonly">
      {loading ? (
        <span className="inline-flex items-center gap-1.5 text-ink-mute">
          <Loader2 className="size-3.5 animate-spin" />
          加载中…
        </span>
      ) : (
        <span className="truncate font-mono text-caption">{value}</span>
      )}
    </div>
  )
}

export function GeneralSettings() {
  const [dataPath, setDataPath] = useState('—')
  const [logPath, setLogPath] = useState('—')
  const [pathsLoading, setPathsLoading] = useState(true)
  const [pathsError, setPathsError] = useState<string | null>(null)

  const [storageFeedback, setStorageFeedback] = useState<string | null>(null)
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const flash = (msg: string, ms = 2500) => {
    setStorageFeedback(msg)
    if (feedbackTimer.current != null) clearTimeout(feedbackTimer.current)
    feedbackTimer.current = setTimeout(() => setStorageFeedback(null), ms)
  }

  useEffect(() => {
    if (typeof window === 'undefined' || !window.electronAPI?.appGetInfo) {
      setPathsLoading(false)
      setPathsError('未获取到（非 Electron 运行环境）')
      return
    }
    window.electronAPI
      .appGetInfo()
      .then((info) => {
        setDataPath(info?.dataPath ?? '—')
        setLogPath(info?.logPath ?? '—')
      })
      .catch((err: unknown) => setPathsError(err instanceof Error ? err.message : String(err)))
      .finally(() => setPathsLoading(false))
    return () => {
      if (feedbackTimer.current != null) clearTimeout(feedbackTimer.current)
    }
  }, [])

  const handleExportData = async () => {
    if (typeof window === 'undefined' || !window.electronAPI?.configGet) {
      flash('当前环境不支持导出数据（非 Electron 运行环境）')
      return
    }
    flash('正在导出数据…')
    try {
      const config: Record<string, unknown> = {}
      await Promise.all(
        EXPORT_CONFIG_KEYS.map(async (key) => {
          try {
            const value = await window.electronAPI!.configGet<unknown>(key)
            if (value !== undefined && value !== null) config[key] = value
          } catch (err) {
            // 单项读不到不影响整体导出，跳过该项
            console.warn(`[GeneralSettings] 导出配置项失败: ${key}`, err)
          }
        }),
      )
      const payload = {
        meta: {
          app: 'tdsf-linux-desktop',
          configSchema: 1,
          exportedAt: new Date().toISOString(),
          keyCount: Object.keys(config).length,
        },
        config,
      }
      const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }))
      const a = document.createElement('a')
      a.href = url
      a.download = `tdsf-config-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      flash(`已导出 ${Object.keys(config).length} 项配置`)
    } catch (err) {
      flash(`导出失败：${err instanceof Error ? err.message : String(err)}`, 3500)
    }
  }

  const handleClearCache = async () => {
    if (typeof window === 'undefined' || !window.electronAPI?.logClearBuffer) {
      flash('当前环境不支持清除缓存（非 Electron 运行环境）')
      return
    }
    flash('正在清除缓存…')
    try {
      const ok = await window.electronAPI.logClearBuffer()
      flash(ok ? '已清除日志缓冲区缓存' : '没有可清除的缓存')
    } catch (err) {
      flash(`清除失败：${err instanceof Error ? err.message : String(err)}`, 3500)
    }
  }

  return (
    <div className="set-subpage">
      <SettingsPageHeader {...settingsHeader('/settings/general')} />

      <div className="set-subpage__body">
        <SettingsCard icon={Database} title="数据与存储" hideTag noHeadBorder>
          <SettingsRow
            label="数据存储路径"
            desc={pathsError ?? '配置、知识库与本地数据库存放处'}
            control={<ReadOnlyPath value={dataPath} loading={pathsLoading} />}
          />
          <SettingsRow
            label="日志文件路径"
            desc="排查问题时先看这里"
            control={<ReadOnlyPath value={logPath} loading={pathsLoading} />}
          />
          <SettingsRow
            label="配置备份"
            desc="导出为 JSON（不含 API Key 等加密项），可用于换机迁移或反馈问题时附带"
            isLast
            control={
              <div className="flex items-center gap-2">
                <button type="button" onClick={handleExportData} className="set-btn-secondary btn-press">
                  <Download className="di-14" />
                  导出数据
                </button>
                <button type="button" onClick={handleClearCache} className="set-btn-secondary btn-press">
                  <Trash2 className="di-14" />
                  清除缓存
                </button>
                {storageFeedback != null && (
                  <span role="status" aria-live="polite" className="set-action-tag">
                    {storageFeedback}
                  </span>
                )}
              </div>
            }
          />
        </SettingsCard>

        {/* 定时任务：调度器 IPC + 实时状态推送，组件自包含 */}
        <SchedulerPanel />
      </div>
    </div>
  )
}
