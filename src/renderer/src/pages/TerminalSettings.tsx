/**
 * TerminalSettings — 终端设置
 *
 * 路由：/settings/terminal
 *
 * 设计稿：settings-terminal.html
 * - Card 1: 默认 Shell 配置（Shell / 参数 / 颜色方案）
 * - Card 2: 终端行为（字号 / 字体族 / 行高 / 光标 / 闪烁 / 缓冲区）
 * - Card 3: 复制与粘贴（自动复制 / 右键粘贴 / 去换行 / 去控制字符）
 * - Card 4: 高级（Bell / 鼠标 / WebGL / SSH 心跳 / 命令超时）
 * - ActionBar: 保存 / 恢复默认
 *
 * 设置项通过 usePersistentState 接入主进程 IPC（configGet/configSet）持久化，
 * electronAPI 不可用时退化为内存默认值，UI 正常渲染。
 */
import { Terminal, Type, Copy, Cpu, type LucideIcon } from 'lucide-react'
import { usePersistentState } from '@/hooks/usePersistentState'
import { SettingsPageHeader } from '@/components/settings/SettingsPageHeader'
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
  const [shellArgs, setShellArgs] = usePersistentState('terminal.shellArgs', '-l')
  const [colorScheme, setColorScheme] = usePersistentState('terminal.colorScheme', 'dark')
  const [loginShell, setLoginShell] = usePersistentState('terminal.loginShell', true)

  // Card 2: 终端行为
  const [fontSize, setFontSize] = usePersistentState('terminal.fontSize', 14)
  const [fontFamily, setFontFamily] = usePersistentState('terminal.fontFamily', 'jetbrains-mono')
  const [lineHeight, setLineHeight] = usePersistentState('terminal.lineHeight', 1.4)
  const [cursorStyle, setCursorStyle] = usePersistentState('terminal.cursorStyle', 'block')
  const [cursorBlink, setCursorBlink] = usePersistentState('terminal.cursorBlink', true)
  const [scrollback, setScrollback] = usePersistentState('terminal.scrollback', 10000)

  // Card 3: 复制与粘贴
  const [autoCopy, setAutoCopy] = usePersistentState('terminal.autoCopy', false)
  const [rightClickPaste, setRightClickPaste] = usePersistentState('terminal.rightClickPaste', true)
  const [stripNewline, setStripNewline] = usePersistentState('terminal.stripNewline', false)
  const [stripControlChars, setStripControlChars] = usePersistentState('terminal.stripControlChars', true)

  // Card 4: 高级
  const [bellEnabled, setBellEnabled] = usePersistentState('terminal.bellEnabled', false)
  const [mouseSupport, setMouseSupport] = usePersistentState('terminal.mouseSupport', true)
  const [webglRenderer, setWebglRenderer] = usePersistentState('terminal.webglRenderer', true)
  const [sshHeartbeat, setSshHeartbeat] = usePersistentState('terminal.sshHeartbeat', 30)
  const [cmdTimeout, setCmdTimeout] = usePersistentState('terminal.cmdTimeout', 300)

  return (
    <div>
      <SettingsPageHeader
        icon={Terminal as LucideIcon}
        title="终端设置"
        desc="Shell 环境与终端行为配置"
      />

      <div className="set-panel-content">
        {/* Card 1: 默认 Shell 配置 */}
        <SettingsCard icon={Terminal} title="默认 Shell 配置" tag="shell.defaults">
          <SettingsRow
            label="默认 Shell"
            desc="新终端会话使用的默认 Shell 程序"
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
          <SettingsRow
            label="Shell 参数"
            desc="启动 Shell 时传递的命令行参数"
            control={
              <Input
                value={shellArgs}
                onChange={(e) => setShellArgs(e.target.value)}
                className="term-settings-input"
              />
            }
          />
          <SettingsRow
            label="颜色方案"
            desc="终端配色主题方案"
            control={
              <Select value={colorScheme} onValueChange={setColorScheme}>
                <SelectTrigger className={selectTriggerCls}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="dark">Dark</SelectItem>
                  <SelectItem value="light">Light</SelectItem>
                  <SelectItem value="solarized-dark">Solarized Dark</SelectItem>
                  <SelectItem value="dracula">Dracula</SelectItem>
                </SelectContent>
              </Select>
            }
          />
          <SettingsRow
            label="登录提示"
            desc="以登录 Shell 方式启动，加载用户环境配置"
            control={<Switch checked={loginShell} onCheckedChange={setLoginShell} />}
            isLast
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
            label="字体族"
            desc="终端使用的等宽字体"
            control={
              <Select value={fontFamily} onValueChange={setFontFamily}>
                <SelectTrigger className={selectTriggerCls}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="jetbrains-mono">JetBrains Mono</SelectItem>
                  <SelectItem value="sf-mono">SF Mono</SelectItem>
                  <SelectItem value="consolas">Consolas</SelectItem>
                  <SelectItem value="fira-code">Fira Code</SelectItem>
                </SelectContent>
              </Select>
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
            label="右键粘贴"
            desc="在终端中右键单击直接粘贴剪贴板内容"
            control={<Switch checked={rightClickPaste} onCheckedChange={setRightClickPaste} />}
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
            label="启用 Bell 铃声"
            desc="命令执行完成或出错时发出提示音"
            control={<Switch checked={bellEnabled} onCheckedChange={setBellEnabled} />}
          />
          <SettingsRow
            label="启用鼠标支持"
            desc="允许在终端中使用鼠标选择、滚动与点击"
            control={<Switch checked={mouseSupport} onCheckedChange={setMouseSupport} />}
          />
          <SettingsRow
            label="启用 WebGL 渲染"
            desc="使用 GPU 加速终端渲染以提升性能"
            control={<Switch checked={webglRenderer} onCheckedChange={setWebglRenderer} />}
          />
          <SettingsRow
            label="SSH 心跳间隔秒"
            desc="SSH 会话保活心跳包发送间隔"
            control={
              <Input
                type="number"
                value={sshHeartbeat}
                onChange={(e) => setSshHeartbeat(Number(e.target.value))}
                className="term-settings-num"
              />
            }
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
            setShellArgs('-l')
            setColorScheme('dark')
            setLoginShell(true)
            setFontSize(14)
            setFontFamily('jetbrains-mono')
            setLineHeight(1.4)
            setCursorStyle('block')
            setCursorBlink(true)
            setScrollback(10000)
            setAutoCopy(false)
            setRightClickPaste(true)
            setStripNewline(false)
            setStripControlChars(true)
            setBellEnabled(false)
            setMouseSupport(true)
            setWebglRenderer(true)
            setSshHeartbeat(30)
            setCmdTimeout(300)
          }}
        />
      </div>
    </div>
  )
}
