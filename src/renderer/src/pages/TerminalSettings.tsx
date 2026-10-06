/**
 * TerminalSettings — 终端设置
 *
 * 路由：/settings/terminal
 *
 * 设计稿：settings-terminal.html
 * - Card 1: 默认 Shell 配置（Shell）
 * - Card 2: 终端行为（字号 / 行高 / 光标 / 闪烁 / 缓冲区）
 * - Card 3: 复制与粘贴（选中自动复制 / 去换行 / 去控制字符）
 * - Card 4: 高级（Bell / 命令超时）
 * - ActionBar: 保存 / 恢复默认
 *
 * 已删掉的假设置（全仓零消费者，遵循 DESIGN.md §10）：
 * - 字体族 terminal.fontFamily：终端字体实际走外观页的 appearance.codeFont，两处会互相打架
 * - 右键粘贴 terminal.rightClickPaste、鼠标支持 terminal.mouseSupport、
 *   WebGL 渲染 terminal.webglRenderer：xterm 侧没有对应开关（WebGL addon 根本没装）
 * - SSH 心跳 terminal.sshHeartbeat：心跳走 SSH 连接页的 sshDefaults.keepAliveIntervalSec
 *
 * 设置项通过 usePersistentState 接入主进程 IPC（configGet/configSet）持久化，
 * electronAPI 不可用时退化为内存默认值，UI 正常渲染。
 */
import { Terminal, Type, Copy, Cpu } from 'lucide-react'
import { usePersistentState } from '@/hooks/usePersistentState'
import { SettingsPageHeader } from '@/components/settings/SettingsPageHeader'
import { settingsHeader } from './settings-sections'
import { SettingsCard } from '@/components/settings/SettingsCard'
import { SettingsRow } from '@/components/settings/SettingsRow'
import { SettingsSlider } from '@/components/settings/SettingsSlider'
import { SettingsActionBar } from '@/components/settings/SettingsActionBar'
import { Switch } from '@/components/trae/Switch'
import { Input } from '@/components/trae/Input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/trae/Select'
import '../components/terminal/Terminal.css'
import './Settings.css'

/** Select 触发器统一样式（140px 宽，30px 高） */
const selectTriggerCls = 'term-settings-select'

export function TerminalSettings() {
  // Card 1: 默认 Shell 配置
  const [shell, setShell] = usePersistentState('terminal.shell', '/bin/bash')

  // Card 2: 终端行为
  const [fontSize, setFontSize] = usePersistentState('terminal.fontSize', 14)
  const [lineHeight, setLineHeight] = usePersistentState('terminal.lineHeight', 1.4)
  const [cursorStyle, setCursorStyle] = usePersistentState('terminal.cursorStyle', 'block')
  const [cursorBlink, setCursorBlink] = usePersistentState('terminal.cursorBlink', true)
  const [scrollback, setScrollback] = usePersistentState('terminal.scrollback', 10000)

  // Card 3: 复制与粘贴
  const [autoCopy, setAutoCopy] = usePersistentState('terminal.autoCopy', false)
  const [stripNewline, setStripNewline] = usePersistentState('terminal.stripNewline', false)
  const [stripControlChars, setStripControlChars] = usePersistentState('terminal.stripControlChars', true)

  // Card 4: 高级
  const [bellEnabled, setBellEnabled] = usePersistentState('terminal.bellEnabled', false)
  const [cmdTimeout, setCmdTimeout] = usePersistentState('terminal.cmdTimeout', 300)

  return (
    <div className="set-subpage">
      <SettingsPageHeader {...settingsHeader('/settings/terminal')} />

      <div className="set-subpage__body">
        {/* Card 1: 默认 Shell 配置 */}
        <SettingsCard icon={Terminal} title="默认 Shell 配置" tag="shell.defaults">
          <SettingsRow
            label="默认 Shell"
            desc="新终端会话使用的默认 Shell 程序"
            isLast
            control={
              <Select value={shell} onValueChange={setShell}>
                <SelectTrigger className={selectTriggerCls}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="/bin/bash">/bin/bash</SelectItem>
                  <SelectItem value="/bin/zsh">/bin/zsh</SelectItem>
                  <SelectItem value="/bin/fish">/bin/fish</SelectItem>
                  <SelectItem value="/bin/sh">/bin/sh</SelectItem>
                </SelectContent>
              </Select>
            }
          />
        </SettingsCard>

        {/* Card 2: 终端行为 */}
        <SettingsCard icon={Type} title="终端行为" tag="terminal.behavior">
          <SettingsRow
            label="字体大小"
            desc="终端文字显示大小（10-24px）"
            control={
              <SettingsSlider
                value={fontSize}
                min={10}
                max={24}
                step={1}
                suffix="px"
                onValueChange={setFontSize}
              />
            }
          />
          <SettingsRow
            label="行高"
            desc="终端文字行间距（1.0-2.0）"
            control={
              <SettingsSlider
                value={lineHeight}
                min={1.0}
                max={2.0}
                step={0.1}
                precision={1}
                onValueChange={setLineHeight}
              />
            }
          />
          <SettingsRow
            label="光标样式"
            desc="终端光标的显示形状"
            control={
              <Select value={cursorStyle} onValueChange={setCursorStyle}>
                <SelectTrigger className={selectTriggerCls}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="block">Block</SelectItem>
                  <SelectItem value="bar">Bar</SelectItem>
                  <SelectItem value="underline">Underline</SelectItem>
                </SelectContent>
              </Select>
            }
          />
          <SettingsRow
            label="光标闪烁"
            desc="终端光标是否闪烁动画"
            control={<Switch checked={cursorBlink} onCheckedChange={setCursorBlink} />}
          />
          <SettingsRow
            label="滚动缓冲区行数"
            desc="终端可回滚查看的历史行数"
            control={
              <Input
                type="number"
                value={scrollback}
                onChange={(e) => setScrollback(Number(e.target.value))}
                className="term-settings-num"
              />
            }
            isLast
          />
        </SettingsCard>

        {/* Card 3: 复制与粘贴 */}
        <SettingsCard icon={Copy} title="复制与粘贴" tag="clipboard">
          <SettingsRow
            label="选中自动复制"
            desc="选中文本时自动复制到系统剪贴板"
            control={<Switch checked={autoCopy} onCheckedChange={setAutoCopy} />}
          />
          <SettingsRow
            label="复制去除换行"
            desc="复制多行内容时自动去除换行符"
            control={<Switch checked={stripNewline} onCheckedChange={setStripNewline} />}
          />
          <SettingsRow
            label="粘贴时去除控制字符"
            desc="粘贴内容时自动过滤控制字符与转义序列"
            control={<Switch checked={stripControlChars} onCheckedChange={setStripControlChars} />}
            isLast
          />
        </SettingsCard>

        {/* Card 4: 高级 */}
        <SettingsCard icon={Cpu} title="高级" tag="advanced">
          <SettingsRow
            label="启用 Bell 提示"
            desc="命令响铃时终端闪一下屏（visual bell）"
            control={<Switch checked={bellEnabled} onCheckedChange={setBellEnabled} />}
          />
          <SettingsRow
            label="命令执行超时秒"
            desc="单条命令最长执行时间，超时自动终止"
            control={
              <Input
                type="number"
                value={cmdTimeout}
                onChange={(e) => setCmdTimeout(Number(e.target.value))}
                className="term-settings-num"
              />
            }
            isLast
          />
        </SettingsCard>

        <SettingsActionBar
          onReset={() => {
            // P1-2 共性问题 A：恢复默认按钮重置所有 usePersistentState 字段
            setShell('/bin/bash')
            setFontSize(14)
            setLineHeight(1.4)
            setCursorStyle('block')
            setCursorBlink(true)
            setScrollback(10000)
            setAutoCopy(false)
            setStripNewline(false)
            setStripControlChars(true)
            setBellEnabled(false)
            setCmdTimeout(300)
          }}
        />
      </div>
    </div>
  )
}
