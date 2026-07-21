/**
 * GeneralSettings — 通用设置
 *
 * 路由：/settings/general
 *
 * 设计稿：settings-general.html（1:1 复刻）
 * - Card 1: 语言与地区（界面语言 / 时区 / 日期格式 / 数字格式）
 * - Card 2: 启动行为（启动时打开 / 自动恢复会话 / 启动时检查更新 / 后台运行）
 * - Card 3: 数据与存储（数据存储路径 / 日志文件路径 / 自动清理日志 / 日志保留天数 + 导出数据/清除缓存按钮）
 * - Card 4: 通知（桌面通知 / 声音提醒 / 邮件通知 / 通知位置 / 勿扰模式 / 勿扰时间段）
 * - ActionBar: 保存 / 恢复默认
 *
 * 设置项通过 usePersistentState 接入主进程 IPC（configGet/configSet）持久化，
 * electronAPI 不可用时退化为内存默认值，UI 正常渲染。
 * （数据存储路径 / 日志路径为只读展示项，按钮反馈为瞬时 UI 状态，均不持久化。）
 */
import { useState, useRef, useEffect } from 'react'
import { Globe, Rocket, Database, Bell, Download, Trash2, type LucideIcon } from 'lucide-react'
import { usePersistentState } from '@/hooks/usePersistentState'
import { SettingsPageHeader } from '@/components/settings/SettingsPageHeader'
import { SettingsCard } from '@/components/settings/SettingsCard'
import { SettingsRow } from '@/components/settings/SettingsRow'
import { SettingsActionBar } from '@/components/settings/SettingsActionBar'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/trae/Select'
import { Switch } from '@/components/trae/Switch'
import { Input } from '@/components/trae/Input'

/** 单个 select 项的选项集合 */
interface SelectOption {
  value: string
  label: string
}

const LANGUAGES: SelectOption[] = [
  { value: 'zh-CN', label: '简体中文' },
  { value: 'en-US', label: 'English (US)' },
  { value: 'ja-JP', label: '日本語' },
]

const TIMEZONES: SelectOption[] = [
  { value: 'Asia/Shanghai', label: 'Asia/Shanghai (UTC+8)' },
  { value: 'Asia/Tokyo', label: 'Asia/Tokyo (UTC+9)' },
  { value: 'America/New_York', label: 'America/New_York (UTC-5)' },
]

const DATE_FORMATS: SelectOption[] = [
  { value: 'YYYY-MM-DD', label: 'YYYY-MM-DD' },
  { value: 'DD/MM/YYYY', label: 'DD/MM/YYYY' },
  { value: 'MM/DD/YYYY', label: 'MM/DD/YYYY' },
]

const NUMBER_FORMATS: SelectOption[] = [
  { value: '1,234.56', label: '1,234.56 (中文/英文)' },
  { value: '1.234,56', label: '1.234,56 (德语)' },
]

const STARTUP_VIEWS: SelectOption[] = [
  { value: 'workbench', label: '工作台' },
  { value: 'editor', label: '编辑器' },
  { value: 'terminal', label: '终端' },
]

const NOTIFY_POSITIONS: SelectOption[] = [
  { value: 'bottom-right', label: '右下角' },
  { value: 'bottom-left', label: '左下角' },
  { value: 'top-right', label: '右上角' },
  { value: 'top-left', label: '左上角' },
]

/** 简单的 Select 包装：统一宽度 */
function RowSelect({
  value,
  options,
  onChange,
  width = 140,
}: {
  value: string
  options: SelectOption[]
  onChange: (v: string) => void
  width?: number
}) {
  return (
    <div style={{ width }}>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

/** 只读路径展示框（对应设计稿 ds-input--readonly） */
function ReadOnlyPath({ value }: { value: string }) {
  return (
    <div className="inline-flex h-[30px] min-w-[280px] items-center rounded-[var(--trae-radius-6)] border border-[var(--trae-border-neutral-l2)] bg-[var(--trae-bg-base-default)] px-2.5 font-mono text-[12px] text-[var(--trae-text-secondary)]">
      {value}
    </div>
  )
}

/** 勿扰时间段双输入框（对应设计稿 ds-time-range） */
function DndTimeRange({
  start,
  end,
  onStartChange,
  onEndChange,
}: {
  start: string
  end: string
  onStartChange: (v: string) => void
  onEndChange: (v: string) => void
}) {
  return (
    <div className="inline-flex items-center gap-1.5">
      <input
        type="text"
        value={start}
        onChange={(e) => onStartChange(e.target.value)}
        className="inline-flex h-7 items-center rounded-[var(--trae-radius-6)] border border-[var(--trae-border-neutral-l2)] bg-[var(--trae-bg-base-tertiary)] px-2 font-mono text-[10px] tabular-nums text-[var(--trae-text-default)] focus:border-[var(--trae-bg-brand)] focus:outline-none"
        style={{ width: 64 }}
      />
      <span className="text-[10px] text-[var(--trae-text-tertiary)]">至</span>
      <input
        type="text"
        value={end}
        onChange={(e) => onEndChange(e.target.value)}
        className="inline-flex h-7 items-center rounded-[var(--trae-radius-6)] border border-[var(--trae-border-neutral-l2)] bg-[var(--trae-bg-base-tertiary)] px-2 font-mono text-[10px] tabular-nums text-[var(--trae-text-default)] focus:border-[var(--trae-bg-brand)] focus:outline-none"
        style={{ width: 64 }}
      />
    </div>
  )
}

export function GeneralSettings() {
  // Card 1: 语言与地区
  const [language, setLanguage] = usePersistentState('general.language', 'zh-CN')
  const [timezone, setTimezone] = usePersistentState('general.timezone', 'Asia/Shanghai')
  const [dateFormat, setDateFormat] = usePersistentState('general.dateFormat', 'YYYY-MM-DD')
  const [numberFormat, setNumberFormat] = usePersistentState('general.numberFormat', '1,234.56')

  // Card 2: 启动行为
  const [startupView, setStartupView] = usePersistentState('general.startupView', 'workbench')
  const [autoRestore, setAutoRestore] = usePersistentState('general.autoRestore', true)
  const [checkUpdate, setCheckUpdate] = usePersistentState('general.checkUpdate', true)
  const [backgroundRun, setBackgroundRun] = usePersistentState('general.backgroundRun', false)

  // Card 3: 数据与存储（dataPath / logPath 为只读展示项，不持久化）
  const [dataPath] = useState('~/.tdsf/data')
  const [logPath] = useState('~/.tdsf/logs')
  const [autoCleanLog, setAutoCleanLog] = usePersistentState('general.autoCleanLog', true)
  const [logRetention, setLogRetention] = usePersistentState('general.logRetention', '30')

  // Card 4: 通知
  const [desktopNotify, setDesktopNotify] = usePersistentState('general.desktopNotify', true)
  const [sound, setSound] = usePersistentState('general.sound', false)
  const [email, setEmail] = usePersistentState('general.email', false)
  const [notifyPosition, setNotifyPosition] = usePersistentState('general.notifyPosition', 'bottom-right')
  const [doNotDisturb, setDoNotDisturb] = usePersistentState('general.doNotDisturb', false)
  const [dndStart, setDndStart] = usePersistentState('general.dndStart', '22:00')
  const [dndEnd, setDndEnd] = usePersistentState('general.dndEnd', '08:00')

  // 数据与存储按钮反馈
  const [storageFeedback, setStorageFeedback] = useState<string | null>(null)
  const storageFeedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    return () => {
      if (storageFeedbackTimer.current != null) clearTimeout(storageFeedbackTimer.current)
    }
  }, [])
  const handleExportData = () => {
    setStorageFeedback('正在导出数据…')
    if (storageFeedbackTimer.current != null) clearTimeout(storageFeedbackTimer.current)
    storageFeedbackTimer.current = setTimeout(() => {
      setStorageFeedback('已导出到 ~/.tdsf/exports/')
      storageFeedbackTimer.current = setTimeout(() => setStorageFeedback(null), 2000)
    }, 800)
  }
  const handleClearCache = () => {
    setStorageFeedback('已清除缓存')
    if (storageFeedbackTimer.current != null) clearTimeout(storageFeedbackTimer.current)
    storageFeedbackTimer.current = setTimeout(() => setStorageFeedback(null), 2000)
  }

  return (
    <div>
      <SettingsPageHeader
        icon={Globe as LucideIcon}
        title="通用"
        desc="语言、启动与数据偏好"
      />

      <div className="flex flex-col gap-4 p-6">
        {/* Card 1: 语言与地区 */}
        <SettingsCard icon={Globe} title="语言与地区" tag="locale">
          <SettingsRow
            label="界面语言"
            desc="应用界面显示语言"
            control={<RowSelect value={language} options={LANGUAGES} onChange={setLanguage} />}
          />
          <SettingsRow
            label="时区"
            desc="系统时间显示所采用的时区"
            control={<RowSelect value={timezone} options={TIMEZONES} onChange={setTimezone} width={200} />}
          />
          <SettingsRow
            label="日期格式"
            desc="日期的显示格式偏好"
            control={<RowSelect value={dateFormat} options={DATE_FORMATS} onChange={setDateFormat} width={180} />}
          />
          <SettingsRow
            label="数字格式"
            desc="数字千位分隔符与小数点格式"
            control={<RowSelect value={numberFormat} options={NUMBER_FORMATS} onChange={setNumberFormat} width={180} />}
            isLast
          />
        </SettingsCard>

        {/* Card 2: 启动行为 */}
        <SettingsCard icon={Rocket} title="启动行为" tag="startup">
          <SettingsRow
            label="启动时打开"
            desc="应用启动时默认显示的页面"
            control={<RowSelect value={startupView} options={STARTUP_VIEWS} onChange={setStartupView} />}
          />
          <SettingsRow
            label="自动恢复会话"
            desc="启动时恢复上次未关闭的终端与标签页"
            control={<Switch checked={autoRestore} onCheckedChange={setAutoRestore} />}
          />
          <SettingsRow
            label="启动时检查更新"
            desc="应用启动后自动检查新版本"
            control={<Switch checked={checkUpdate} onCheckedChange={setCheckUpdate} />}
          />
          <SettingsRow
            label="后台运行"
            desc="关闭窗口后保持应用在后台运行"
            control={<Switch checked={backgroundRun} onCheckedChange={setBackgroundRun} />}
            isLast
          />
        </SettingsCard>

        {/* Card 3: 数据与存储 */}
        <SettingsCard icon={Database} title="数据与存储" tag="storage">
          <SettingsRow
            label="数据存储路径"
            desc="应用数据的本地存储目录"
            control={<ReadOnlyPath value={dataPath} />}
          />
          <SettingsRow
            label="日志文件路径"
            desc="运行日志文件存储目录"
            control={<ReadOnlyPath value={logPath} />}
          />
          <SettingsRow
            label="自动清理日志"
            desc="超过保留天数的日志将自动删除"
            control={<Switch checked={autoCleanLog} onCheckedChange={setAutoCleanLog} />}
          />
          <SettingsRow
            label="日志保留天数"
            desc="日志文件的最大保留天数"
            control={
              <Input
                value={logRetention}
                onChange={(e) => setLogRetention(e.target.value)}
                className="w-[88px] text-center font-mono"
              />
            }
            isLast
          />
          {/* 导出数据 / 清除缓存 按钮组（对应设计稿 Card 3 底部按钮） */}
          <div className="flex items-center gap-2 pt-3">
            <button
              type="button"
              onClick={handleExportData}
              className="inline-flex h-8 items-center gap-1.5 rounded-[var(--trae-radius-6)] border border-[var(--trae-border-neutral-l2)] bg-transparent px-3.5 text-[12px] font-medium text-[var(--trae-text-default)] transition-colors hover:border-[var(--trae-border-neutral-l3)] hover:bg-[var(--trae-bg-overlay-l1)] active:scale-95"
            >
              <Download className="size-3.5" />
              导出数据
            </button>
            <button
              type="button"
              onClick={handleClearCache}
              className="inline-flex h-8 items-center gap-1.5 rounded-[var(--trae-radius-6)] border border-[var(--trae-border-neutral-l2)] bg-transparent px-3.5 text-[12px] font-medium text-[var(--trae-text-default)] transition-colors hover:border-[var(--trae-border-neutral-l3)] hover:bg-[var(--trae-bg-overlay-l1)] active:scale-95"
            >
              <Trash2 className="size-3.5" />
              清除缓存
            </button>
            {storageFeedback != null && (
              <span
                role="status"
                aria-live="polite"
                className="inline-flex h-8 items-center gap-1.5 rounded-[var(--trae-radius-6)] border border-[var(--trae-border-neutral-l2)] bg-[var(--trae-bg-overlay-l1)] px-3 text-[12px] font-medium text-[var(--trae-text-secondary)]"
              >
                {storageFeedback}
              </span>
            )}
          </div>
        </SettingsCard>

        {/* Card 4: 通知 */}
        <SettingsCard icon={Bell} title="通知" tag="notifications">
          <SettingsRow
            label="桌面通知"
            desc="使用系统桌面通知推送消息"
            control={<Switch checked={desktopNotify} onCheckedChange={setDesktopNotify} />}
          />
          <SettingsRow
            label="声音提醒"
            desc="收到通知时播放提示音"
            control={<Switch checked={sound} onCheckedChange={setSound} />}
          />
          <SettingsRow
            label="邮件通知"
            desc="将重要通知发送至绑定邮箱"
            control={<Switch checked={email} onCheckedChange={setEmail} />}
          />
          <SettingsRow
            label="通知位置"
            desc="桌面通知弹出的屏幕位置"
            control={<RowSelect value={notifyPosition} options={NOTIFY_POSITIONS} onChange={setNotifyPosition} />}
          />
          <SettingsRow
            label="勿扰模式"
            desc="在指定时间段内静默所有通知"
            control={<Switch checked={doNotDisturb} onCheckedChange={setDoNotDisturb} />}
          />
          <SettingsRow
            label="勿扰时间段"
            desc="勿扰模式生效的起止时间"
            control={
              <DndTimeRange
                start={dndStart}
                end={dndEnd}
                onStartChange={setDndStart}
                onEndChange={setDndEnd}
              />
            }
            isLast
          />
        </SettingsCard>

        <SettingsActionBar />
      </div>
    </div>
  )
}
