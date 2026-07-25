/**
 * ds-ui.tsx — TDSF Linux 设计稿 ds- 组件库
 *
 * 1:1 对齐 design-assets/pages/设置.html 的 .ds-* CSS 类定义。
 * 所有尺寸/圆角/颜色/字重均严格按设计稿原值实现，不使用 Tailwind 工具类，
 * 而是直接使用 inline style + var(--token) 引用 globals.css 中定义的设计 token。
 *
 * 组件清单：
 * - DsSettings       根容器（.ds-settings）
 * - DsPageHeader     页头（.ds-pageheader + iconwrap + title）
 * - DsBackBtn        返回按钮（.ds-backbtn）
 * - DsLayout         两栏布局（.ds-layout = 220px nav + panel）
 * - DsNav            二级导航容器（.ds-nav）
 * - DsNavItem        导航项（.ds-nav__item.is-active）
 * - DsPanel          主面板（.ds-panel）
 * - DsCard           卡片（.ds-card + head + title + tag）
 * - DsRow            设置行（.ds-row + label + desc + control）
 * - DsSelect         下拉选择（.ds-select）
 * - DsToggle         开关（.ds-toggle + track + thumb）
 * - DsSlider         滑块（.ds-slider + track + fill + thumb + val）
 * - DsBtnPrimary     主按钮（.ds-btn-primary）
 * - DsBtnSecondary   次按钮（.ds-btn-secondary）
 * - DsBtnGhost       幽灵按钮
 * - DsBtnDanger      危险按钮
 * - DsActionBar      操作条（.ds-actionbar）
 * - DsSaveHint       保存提示（.ds-savehint）
 * - DsFormInput      表单输入框
 * - DsFormLabel      表单标签
 * - DsRadioGroup     单选组
 * - DsRadioCard      单选卡片
 * - DsSwatch         色板
 * - DsThemeCard      主题卡片
 * - DsStatCard       统计卡片
 * - DsTable          表格
 * - DsTag            标签
 */

import {
  type ReactNode,
  type CSSProperties,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type HTMLAttributes,
  useState,
  type MouseEvent,
} from 'react'

/* ============================================================
 * 工具：press 反馈类
 * ============================================================ */
const PRESS_CLASS = 'btn-press'

/* ============================================================
 * DsSettings — 根容器
 * ============================================================ */
export function DsSettings({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div
      className="ds-settings"
      style={{
        width: '100%',
        minHeight: '100%',
        background: 'var(--bg-base-default)',
        color: 'var(--text-default)',
        fontFamily: 'var(--body-base-font-family)',
        fontSize: 'var(--body-base-font-size)',
        lineHeight: 'var(--body-base-line-height)',
        boxSizing: 'border-box',
        ...style,
      }}
    >
      {children}
    </div>
  )
}

/* ============================================================
 * DsPageHeader — 页头（iconwrap + title + 副标题 + 右侧 actions）
 * ============================================================ */
export function DsPageHeader({
  icon,
  title,
  subtitle,
  actions,
  titleStyle,
}: {
  icon?: ReactNode
  title: string
  subtitle?: string
  actions?: ReactNode
  titleStyle?: CSSProperties
}) {
  return (
    <header
      className="ds-pageheader"
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: '24px',
        padding: '20px 24px 18px',
        borderBottom: '1px solid var(--border-neutral-l1)',
      }}
    >
      <div
        className="ds-pageheader__left"
        style={{ display: 'flex', alignItems: 'center', gap: '12px' }}
      >
        {icon && (
          <span
            className="ds-pageheader__iconwrap"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '40px',
              height: '40px',
              background: 'var(--bg-brand-popup)',
              border: '1px solid #387BFF',
              borderRadius: 'var(--radius-10)',
              color: 'var(--bg-brand)',
              flexShrink: 0,
            }}
          >
            {icon}
          </span>
        )}
        <div className="ds-pageheader__title">
          <h1
            style={{
              margin: 0,
              fontFamily: 'var(--heading-2xl-font-family)',
              fontSize: 'var(--heading-2xl-font-size)',
              fontWeight: 'var(--heading-2xl-font-weight)',
              lineHeight: 'var(--heading-2xl-line-height)',
              color: 'var(--text-default)',
              letterSpacing: '-0.012em',
              ...titleStyle,
            }}
          >
            {title}
          </h1>
          {subtitle && (
            <p
              style={{
                margin: '2px 0 0',
                fontSize: 'var(--body-xs-font-size)',
                lineHeight: 'var(--body-xs-line-height)',
                color: 'var(--text-secondary)',
              }}
            >
              {subtitle}
            </p>
          )}
        </div>
      </div>
      {actions && <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>{actions}</div>}
    </header>
  )
}

/* ============================================================
 * DsBackBtn — 返回按钮
 * ============================================================ */
export function DsBackBtn({
  children = '返回',
  onClick,
}: {
  children?: ReactNode
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      className={`ds-backbtn ${PRESS_CLASS}`}
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        height: '32px',
        padding: '0 12px',
        background: 'transparent',
        border: '1px solid var(--border-neutral-l2)',
        borderRadius: 'var(--radius-6)',
        color: 'var(--text-default)',
        fontSize: 'var(--body-sm-font-size)',
        fontWeight: 'var(--body-sm-strong-font-weight)',
        cursor: 'pointer',
        transition: 'background .15s ease, border-color .15s ease',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'var(--bg-overlay-l1)'
        e.currentTarget.style.borderColor = 'var(--border-neutral-l3)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent'
        e.currentTarget.style.borderColor = 'var(--border-neutral-l2)'
      }}
    >
      {children}
    </button>
  )
}

/* ============================================================
 * DsLayout — 两栏布局：220px nav + 主面板
 * ============================================================ */
export function DsLayout({
  nav,
  children,
}: {
  nav: ReactNode
  children: ReactNode
}) {
  return (
    <div
      className="ds-layout"
      style={{
        display: 'flex',
        gap: '20px',
        padding: '20px 24px 96px',
        alignItems: 'flex-start',
      }}
    >
      <nav
        className="ds-nav"
        style={{
          flex: '0 0 220px',
          display: 'flex',
          flexDirection: 'column',
          gap: '2px',
          padding: '8px',
          background: 'var(--bg-base-secondary)',
          border: '1px solid var(--border-neutral-l1)',
          borderRadius: 'var(--radius-8)',
          position: 'sticky',
          top: '20px',
        }}
      >
        {nav}
      </nav>
      <section className="ds-panel" style={{ flex: '1 1 0', minWidth: 0, display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {children}
      </section>
    </div>
  )
}

/* ============================================================
 * DsNavItem — 二级导航项
 * ============================================================ */
export function DsNavItem({
  icon,
  label,
  active = false,
  onClick,
  domId,
  indicatorWidth = 2,
}: {
  icon?: ReactNode
  label: string
  active?: boolean
  onClick?: () => void
  domId?: string
  indicatorWidth?: number
}) {
  return (
    <button
      type="button"
      data-dom-id={domId}
      onClick={onClick}
      className={`ds-nav__item ${active ? 'is-active' : ''}`}
      style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        height: '36px',
        padding: '0 12px',
        borderRadius: 'var(--radius-6)',
        background: active ? 'var(--bg-overlay-l2)' : 'transparent',
        border: 'none',
        color: active ? 'var(--text-default)' : 'var(--text-secondary)',
        fontSize: 'var(--body-sm-font-size)',
        fontWeight: active
          ? 'var(--body-sm-strong-font-weight)'
          : 'var(--body-sm-font-weight)',
        cursor: 'pointer',
        textAlign: 'left',
        transition: 'background .15s ease, color .15s ease',
      }}
      onMouseEnter={(e) => {
        if (!active) {
          e.currentTarget.style.background = 'var(--bg-overlay-l1)'
          e.currentTarget.style.color = 'var(--text-default)'
        }
      }}
      onMouseLeave={(e) => {
        if (!active) {
          e.currentTarget.style.background = 'transparent'
          e.currentTarget.style.color = 'var(--text-secondary)'
        }
      }}
    >
      {active && (
        <span
          aria-hidden
          style={{
            content: '""',
            position: 'absolute',
            left: '-8px',
            top: '8px',
            bottom: '8px',
            width: `${indicatorWidth}px`,
            background: 'var(--bg-brand)',
            borderRadius: 'var(--radius-full)',
          }}
        />
      )}
      {icon && (
        <span style={{ color: active ? 'var(--bg-brand)' : 'var(--icon-secondary)', display: 'inline-flex' }}>
          {icon}
        </span>
      )}
      <span>{label}</span>
    </button>
  )
}

/* ============================================================
 * DsCard — 卡片容器
 * ============================================================ */
export function DsCard({
  title,
  icon,
  tag,
  children,
  className = '',
  style,
  onClick,
}: {
  title?: string
  icon?: ReactNode
  tag?: ReactNode
  children?: ReactNode
  className?: string
  style?: CSSProperties
  onClick?: () => void
}) {
  const clickable = !!onClick
  return (
    <div
      className={`ds-card ${clickable ? 'ds-card-setting' : ''} ${className}`}
      onClick={onClick}
      style={{
        background: 'var(--bg-base-secondary)',
        border: '1px solid var(--border-neutral-l1)',
        borderRadius: 'var(--radius-8)',
        padding: '16px',
        boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
        cursor: clickable ? 'pointer' : 'default',
        ...(clickable
          ? {
              transition: 'border-color 160ms ease-out, transform 160ms ease-out, background 160ms ease-out, box-shadow 160ms ease-out',
            }
          : {}),
        ...style,
      }}
      onMouseEnter={(e) => {
        if (clickable) {
          e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.4)'
        }
      }}
      onMouseLeave={(e) => {
        if (clickable) {
          e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.3)'
        }
      }}
    >
      {title !== undefined && (
        <div
          className="ds-card__head"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            marginBottom: '4px',
            paddingBottom: '12px',
            borderBottom: '1px solid var(--trae-border-neutral-l1, #3A3D42)',
            background: 'var(--trae-bg-overlay-l2, #252629)',
            margin: '-16px -16px 12px',
            padding: '12px 16px',
            borderTopLeftRadius: 'var(--radius-8)',
            borderTopRightRadius: 'var(--radius-8)',
          }}
        >
          {icon && <span style={{ color: 'var(--bg-brand)', display: 'inline-flex' }}>{icon}</span>}
          {title && (
            <h3
              className="ds-card__title"
              style={{
                margin: 0,
                fontFamily: 'var(--heading-xs-font-family)',
                fontSize: 'var(--heading-xs-font-size)',
                fontWeight: 'var(--heading-xs-font-weight)',
                lineHeight: 'var(--heading-xs-line-height)',
                color: 'var(--text-default)',
              }}
            >
              {title}
            </h3>
          )}
          {tag && (
            <span
              className="ds-card__tag"
              style={{
                marginLeft: 'auto',
                fontSize: 'var(--body-xs-font-size)',
                color: 'var(--text-tertiary)',
                fontFamily: 'var(--code-editor-font-family)',
              }}
            >
              {tag}
            </span>
          )}
        </div>
      )}
      {children}
    </div>
  )
}

/* ============================================================
 * DsRow — 设置项行（label + desc + 右侧 control）
 * ============================================================ */
export function DsRow({
  label,
  desc,
  control,
  last = false,
}: {
  label?: ReactNode
  desc?: ReactNode
  control?: ReactNode
  last?: boolean
}) {
  return (
    <div
      className="ds-row"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '16px',
        padding: '12px 0',
        borderBottom: last ? 'none' : '1px solid var(--border-neutral-l1)',
        paddingBottom: last ? '2px' : undefined,
      }}
    >
      <div className="ds-row__text" style={{ minWidth: 0, flex: '1 1 auto' }}>
        {label !== undefined && (
          <div
            className="ds-row__label"
            style={{
              fontSize: 'var(--body-sm-strong-font-size)',
              fontWeight: 'var(--body-sm-strong-font-weight)',
              lineHeight: '18px',
              color: 'var(--text-default)',
            }}
          >
            {label}
          </div>
        )}
        {desc && (
          <div
            className="ds-row__desc"
            style={{
              marginTop: '2px',
              fontSize: 'var(--body-xs-font-size)',
              lineHeight: 'var(--body-xs-line-height)',
              color: 'var(--text-secondary)',
            }}
          >
            {desc}
          </div>
        )}
      </div>
      {control && (
        <div className="ds-row__control" style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center' }}>
          {control}
        </div>
      )}
    </div>
  )
}

/* ============================================================
 * DsSelect — 下拉选择
 * ============================================================ */
export function DsSelect({
  value,
  options,
  onChange,
  'aria-label': ariaLabel,
}: {
  value: string
  options: { value: string; label: string }[]
  onChange: (v: string) => void
  'aria-label'?: string
}) {
  return (
    <div
      className="ds-select"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        height: '30px',
        padding: '0 8px 0 12px',
        background: 'var(--bg-base-tertiary)',
        border: '1px solid var(--border-neutral-l2)',
        borderRadius: 'var(--radius-6)',
        color: 'var(--text-default)',
        fontSize: 'var(--body-sm-font-size)',
        cursor: 'pointer',
        transition: 'border-color .15s ease',
      }}
    >
      <select
        aria-label={ariaLabel}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          appearance: 'none',
          background: 'transparent',
          border: 'none',
          color: 'inherit',
          font: 'inherit',
          cursor: 'inherit',
          outline: 'none',
          paddingRight: '4px',
        }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value} style={{ background: 'var(--bg-base-tertiary)', color: 'var(--text-default)' }}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  )
}

/* ============================================================
 * DsToggle — 开关（34x18，thumb 14x14，translateX 16px when checked）
 * ============================================================ */
export function DsToggle({
  checked,
  onChange,
  disabled = false,
  'aria-label': ariaLabel,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
  'aria-label'?: string
}) {
  return (
    <span
      className="ds-toggle"
      style={{
        position: 'relative',
        display: 'inline-block',
        width: '34px',
        height: '18px',
        flex: '0 0 auto',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
      }}
      onClick={() => !disabled && onChange(!checked)}
    >
      <input
        type="checkbox"
        checked={checked}
        readOnly
        aria-label={ariaLabel}
        style={{ position: 'absolute', opacity: 0, width: 0, height: 0, margin: 0 }}
      />
      <span
        className="ds-toggle__track"
        style={{
          position: 'absolute',
          inset: 0,
          background: checked ? 'var(--bg-brand)' : 'var(--border-neutral-l3)',
          borderRadius: 'var(--radius-full)',
          transition: 'background .18s ease',
        }}
      >
        <span
          className="ds-toggle__thumb"
          style={{
            position: 'absolute',
            top: '2px',
            left: '2px',
            width: '14px',
            height: '14px',
            background: 'var(--trae-special-white, #FFFFFF)',
            borderRadius: '50%',
            transform: checked ? 'translateX(16px)' : 'translateX(0)',
            transition: 'transform .18s cubic-bezier(.4,0,.2,1)',
            boxShadow: '0 1px 2px rgba(0,0,0,.3)',
          }}
        />
      </span>
    </span>
  )
}

/* ============================================================
 * DsSlider — 滑块（带 val 显示）
 * ============================================================ */
export function DsSlider({
  value,
  min,
  max,
  step = 1,
  onChange,
  width = 240,
  showValue = true,
  minLabel,
  maxLabel,
  'aria-label': ariaLabel,
}: {
  value: number
  min: number
  max: number
  step?: number
  onChange: (v: number) => void
  width?: number
  showValue?: boolean
  minLabel?: string
  maxLabel?: string
  'aria-label'?: string
}) {
  const percent = max > min ? ((value - min) / (max - min)) * 100 : 0
  return (
    <div
      className="ds-slider"
      style={{ display: 'flex', alignItems: 'center', gap: '12px', width: `${width}px` }}
    >
      <div style={{ position: 'relative', flex: '1 1 auto' }}>
        <div
          className="ds-slider__track"
          style={{
            position: 'relative',
            height: '4px',
            background: 'var(--border-neutral-l2)',
            borderRadius: 'var(--radius-full)',
          }}
        >
          <div
            className="ds-slider__fill"
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              bottom: 0,
              width: `${percent}%`,
              background: 'var(--bg-brand)',
              borderRadius: 'var(--radius-full)',
            }}
          />
          <div
            className="ds-slider__thumb"
            style={{
              position: 'absolute',
              top: '50%',
              left: `${percent}%`,
              width: '14px',
              height: '14px',
              background: 'var(--trae-special-white, #FFFFFF)',
              borderRadius: '50%',
              transform: 'translate(-50%, -50%)',
              boxShadow: '0 0 0 2px var(--bg-brand), 0 1px 3px rgba(0,0,0,.4)',
              cursor: 'grab',
            }}
          />
        </div>
        {(minLabel || maxLabel) && (
          <div
            className="ds-slider__range"
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              marginTop: '6px',
              fontSize: 'var(--body-xs-font-size)',
              color: 'var(--text-tertiary)',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            <span>{minLabel}</span>
            <span>{maxLabel}</span>
          </div>
        )}
      </div>
      {showValue && (
        <span
          className="ds-slider__val"
          style={{
            flex: '0 0 auto',
            fontFamily: 'var(--code-editor-font-family)',
            fontSize: 'var(--code-editor-font-size)',
            fontWeight: 'var(--font-weight-code)',
            color: 'var(--bg-brand)',
            fontVariantNumeric: 'tabular-nums',
            minWidth: '34px',
            textAlign: 'right',
          }}
        >
          {value}
        </span>
      )}
      {/* 透明 range input 叠加在 track 上接收交互 */}
      <input
        type="range"
        aria-label={ariaLabel}
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          opacity: 0,
          cursor: 'pointer',
          margin: 0,
        }}
      />
    </div>
  )
}

/* ============================================================
 * 按钮组件 — primary / secondary / ghost / danger
 * ============================================================ */
type DsBtnVariant = 'primary' | 'secondary' | 'ghost' | 'danger'

interface DsBtnProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: DsBtnVariant
  children: ReactNode
}

const dsBtnBaseStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '6px',
  height: '32px',
  padding: '0 16px',
  borderRadius: 'var(--radius-6)',
  fontSize: 'var(--body-sm-font-size)',
  fontWeight: 'var(--body-sm-strong-font-weight)',
  cursor: 'pointer',
  transition: 'background .15s ease, border-color .15s ease, color .15s ease',
  border: '1px solid transparent',
  font: 'inherit',
}

function dsBtnVariantStyle(variant: DsBtnVariant): CSSProperties {
  switch (variant) {
    case 'primary':
      return {
        background: 'var(--bg-brand)',
        borderColor: 'var(--bg-brand)',
        color: 'var(--text-onbrand)',
      }
    case 'secondary':
      return {
        background: 'transparent',
        borderColor: 'var(--border-neutral-l2)',
        color: 'var(--text-default)',
        padding: '0 14px',
      }
    case 'ghost':
      return {
        background: 'transparent',
        borderColor: 'transparent',
        color: 'var(--text-secondary)',
      }
    case 'danger':
      return {
        background: 'var(--status-error-default)',
        borderColor: 'var(--status-error-default)',
        color: 'var(--trae-special-white, #FFFFFF)',
      }
  }
}

function dsBtnHoverStyle(variant: DsBtnVariant): CSSProperties {
  switch (variant) {
    case 'primary':
      return {
        background: 'var(--bg-brand-hover)',
        borderColor: 'var(--bg-brand-hover)',
      }
    case 'secondary':
      return {
        background: 'var(--bg-overlay-l1)',
        borderColor: 'var(--border-neutral-l3)',
      }
    case 'ghost':
      return {
        background: 'var(--bg-overlay-l1)',
        color: 'var(--text-default)',
      }
    case 'danger':
      return {
        background: 'var(--status-error-hover)',
        borderColor: 'var(--status-error-hover)',
      }
  }
}

export function DsButton({ variant = 'primary', children, style, onMouseEnter, onMouseLeave, ...rest }: DsBtnProps) {
  const [hover, setHover] = useState(false)
  return (
    <button
      {...rest}
      className={`ds-btn-${variant} ${PRESS_CLASS}`}
      style={{
        ...dsBtnBaseStyle,
        ...dsBtnVariantStyle(variant),
        ...(hover ? dsBtnHoverStyle(variant) : {}),
        ...style,
      }}
      onMouseEnter={(e: MouseEvent<HTMLButtonElement>) => {
        setHover(true)
        onMouseEnter?.(e)
      }}
      onMouseLeave={(e: MouseEvent<HTMLButtonElement>) => {
        setHover(false)
        onMouseLeave?.(e)
      }}
    >
      {children}
    </button>
  )
}

/* ============================================================
 * DsActionBar — 操作条（底部固定）
 * ============================================================ */
export function DsActionBar({ children }: { children: ReactNode }) {
  return (
    <div
      className="ds-actionbar"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        padding: '16px 0 0',
        marginTop: '4px',
        borderTop: '1px solid var(--border-neutral-l1)',
      }}
    >
      {children}
    </div>
  )
}

/* ============================================================
 * DsSaveHint — 保存成功提示
 * ============================================================ */
export function DsSaveHint({ children = '已保存', visible = false }: { children?: ReactNode; visible?: boolean }) {
  if (!visible) return null
  return (
    <span
      className="ds-savehint"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        marginLeft: 'auto',
        fontSize: 'var(--body-xs-font-size)',
        color: 'var(--status-success-default)',
      }}
    >
      {children}
    </span>
  )
}

/* ============================================================
 * DsFormInput — 表单输入框
 * ============================================================ */
interface DsFormInputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean
}
export function DsFormInput({ invalid = false, style, ...rest }: DsFormInputProps) {
  return (
    <input
      {...rest}
      style={{
        height: '32px',
        padding: '0 12px',
        background: 'var(--bg-base-tertiary)',
        border: `1px solid ${invalid ? 'var(--status-error-default)' : 'var(--border-neutral-l2)'}`,
        borderRadius: 'var(--radius-6)',
        color: 'var(--text-default)',
        fontSize: 'var(--body-sm-font-size)',
        outline: 'none',
        transition: 'border-color .15s ease',
        ...style,
      }}
      onFocus={(e) => {
        e.currentTarget.style.borderColor = 'var(--bg-brand)'
      }}
      onBlur={(e) => {
        e.currentTarget.style.borderColor = invalid
          ? 'var(--status-error-default)'
          : 'var(--border-neutral-l2)'
      }}
    />
  )
}

/* ============================================================
 * DsFormLabel — 表单标签
 * ============================================================ */
export function DsFormLabel({ children, required = false }: { children: ReactNode; required?: boolean }) {
  return (
    <label
      style={{
        display: 'block',
        fontSize: 'var(--body-sm-strong-font-size)',
        fontWeight: 'var(--body-sm-strong-font-weight)',
        color: 'var(--text-default)',
        marginBottom: '6px',
      }}
    >
      {children}
      {required && <span style={{ color: 'var(--status-error-default)', marginLeft: '4px' }}>*</span>}
    </label>
  )
}

/* ============================================================
 * DsRadioCard — 单选卡片（用于风险控制 / 外观设置）
 * ============================================================ */
export function DsRadioCard({
  title,
  desc,
  selected = false,
  onClick,
  children,
}: {
  title: string
  desc?: string
  selected?: boolean
  onClick?: () => void
  children?: ReactNode
}) {
  return (
    <div
      onClick={onClick}
      className={`ds-radio-card ${selected ? 'is-selected' : ''}`}
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
        padding: '12px',
        background: selected ? 'var(--status-primary-surface-l1)' : 'var(--bg-base-tertiary)',
        border: `1px solid ${selected ? 'var(--bg-brand)' : 'var(--border-neutral-l2)'}`,
        borderRadius: 'var(--radius-8)',
        cursor: 'pointer',
        transition: 'border-color .15s ease, background .15s ease',
      }}
    >
      <div className="ds-radio-card__head" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span
          className="ds-radio-card__dot"
          style={{
            width: '14px',
            height: '14px',
            borderRadius: '50%',
            border: `2px solid ${selected ? 'var(--bg-brand)' : 'var(--border-neutral-l3)'}`,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          {selected && (
            <span
              style={{
                width: '6px',
                height: '6px',
                borderRadius: '50%',
                background: 'var(--bg-brand)',
              }}
            />
          )}
        </span>
        <span
          style={{
            fontSize: 'var(--body-sm-strong-font-size)',
            fontWeight: 'var(--body-sm-strong-font-weight)',
            color: 'var(--text-default)',
          }}
        >
          {title}
        </span>
      </div>
      {desc && (
        <div style={{ fontSize: 'var(--body-xs-font-size)', color: 'var(--text-secondary)', marginTop: '2px' }}>
          {desc}
        </div>
      )}
      {children}
    </div>
  )
}

/* ============================================================
 * DsTag — 标签（5 态）
 * ============================================================ */
type DsTagVariant = 'brand' | 'success' | 'warning' | 'danger' | 'neutral-strong'

const dsTagStyleMap: Record<DsTagVariant, CSSProperties> = {
  brand: {
    background: 'var(--status-primary-surface-l1)',
    color: 'var(--bg-brand)',
  },
  success: {
    background: 'var(--status-success-surface-l1)',
    color: 'var(--status-success-default)',
  },
  warning: {
    background: 'var(--status-warning-surface-l1)',
    color: 'var(--status-warning-default)',
  },
  danger: {
    background: 'var(--status-error-surface-l1)',
    color: 'var(--status-error-default)',
  },
  'neutral-strong': {
    background: 'var(--bg-overlay-l2)',
    color: 'var(--text-default)',
  },
}

export function DsTag({
  variant = 'neutral-strong',
  children,
}: {
  variant?: DsTagVariant
  children: ReactNode
}) {
  return (
    <span
      className={`ds-tag ds-tag--${variant}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        height: '20px',
        padding: '0 8px',
        borderRadius: 'var(--radius-4)',
        fontSize: 'var(--body-xs-font-size)',
        fontWeight: 500,
        ...dsTagStyleMap[variant],
      }}
    >
      {children}
    </span>
  )
}

/* ============================================================
 * DsStatCard — 统计卡片
 * ============================================================ */
export function DsStatCard({
  label,
  value,
  unit,
  trend,
}: {
  label: string
  value: string | number
  unit?: string
  trend?: { value: string; up: boolean }
}) {
  return (
    <div className="ds-statcard" style={{ padding: '12px 16px', background: 'var(--bg-base-secondary)', border: '1px solid var(--border-neutral-l1)', borderRadius: 'var(--radius-8)' }}>
      <div className="ds-statcard__label" style={{ fontSize: 'var(--body-xs-font-size)', color: 'var(--text-secondary)', marginBottom: '4px' }}>
        {label}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '4px' }}>
        <span
          className="ds-statcard__value"
          style={{
            fontFamily: 'var(--code-editor-font-family)',
            fontSize: '20px',
            fontWeight: 'var(--font-weight-strong)',
            color: 'var(--text-default)',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {value}
        </span>
        {unit && <span style={{ fontSize: 'var(--body-xs-font-size)', color: 'var(--text-tertiary)' }}>{unit}</span>}
      </div>
      {trend && (
        <div style={{ marginTop: '4px', fontSize: 'var(--body-xs-font-size)', color: trend.up ? 'var(--status-success-default)' : 'var(--status-error-default)' }}>
          {trend.up ? '↑' : '↓'} {trend.value}
        </div>
      )}
    </div>
  )
}

/* ============================================================
 * DsTable — 表格
 * ============================================================ */
export function DsTable({
  columns,
  rows,
}: {
  columns: { key: string; label: string; width?: number }[]
  rows: Record<string, ReactNode>[]
}) {
  return (
    <div style={{ border: '1px solid var(--border-neutral-l1)', borderRadius: 'var(--radius-8)', overflow: 'hidden' }}>
      <div
        className="ds-table-head"
        style={{ display: 'flex', background: 'var(--bg-overlay-l1)', borderBottom: '1px solid var(--border-neutral-l1)' }}
      >
        {columns.map((c) => (
          <div
            key={c.key}
            className="ds-table-head__col"
            style={{
              flex: c.width ? `0 0 ${c.width}px` : '1 1 0',
              padding: '8px 12px',
              fontSize: 'var(--body-xs-font-size)',
              fontWeight: 'var(--body-sm-strong-font-weight)',
              color: 'var(--text-secondary)',
            }}
          >
            {c.label}
          </div>
        ))}
      </div>
      {rows.map((row, i) => (
        <div
          key={i}
          style={{
            display: 'flex',
            borderBottom: i === rows.length - 1 ? 'none' : '1px solid var(--border-neutral-l1)',
            background: 'var(--bg-base-secondary)',
          }}
        >
          {columns.map((c) => (
            <div
              key={c.key}
              style={{
                flex: c.width ? `0 0 ${c.width}px` : '1 1 0',
                padding: '10px 12px',
                fontSize: 'var(--body-sm-font-size)',
                color: 'var(--text-default)',
              }}
            >
              {row[c.key]}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

/* ============================================================
 * DsDivider — 分隔线
 * ============================================================ */
export function DsDivider({ vertical = false }: { vertical?: boolean }) {
  if (vertical) {
    return (
      <div
        aria-hidden
        style={{
          width: '1px',
          alignSelf: 'stretch',
          background: 'var(--border-neutral-l1)',
        }}
      />
    )
  }
  return (
    <div
      aria-hidden
      style={{
        height: '1px',
        width: '100%',
        background: 'var(--border-neutral-l1)',
      }}
    />
  )
}

/* ============================================================
 * DsTextMuted — 次要文字
 * ============================================================ */
export function DsTextMuted({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <span style={{ color: 'var(--text-secondary)', fontSize: 'var(--body-sm-font-size)', ...style }}>
      {children}
    </span>
  )
}

/* ============================================================
 * DsEmptyState — 空态占位
 * ============================================================ */
export function DsEmptyState({
  icon,
  title,
  desc,
  action,
}: {
  icon?: ReactNode
  title: string
  desc?: string
  action?: ReactNode
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '64px 24px',
        textAlign: 'center',
      }}
    >
      {icon && (
        <div style={{ marginBottom: '12px', color: 'var(--icon-tertiary)', opacity: 0.5 }}>{icon}</div>
      )}
      <div style={{ fontSize: 'var(--body-md-strong-font-size)', fontWeight: 'var(--body-md-strong-font-weight)', color: 'var(--text-secondary)' }}>
        {title}
      </div>
      {desc && (
        <div style={{ marginTop: '4px', fontSize: 'var(--body-xs-font-size)', color: 'var(--text-tertiary)', maxWidth: '320px' }}>
          {desc}
        </div>
      )}
      {action && <div style={{ marginTop: '16px' }}>{action}</div>}
    </div>
  )
}

/* ============================================================
 * 兼容旧调用别名（避免大规模重构）
 * ============================================================ */
export const DsBtnPrimary = (props: Omit<DsBtnProps, 'variant'>) => <DsButton variant="primary" {...props} />
export const DsBtnSecondary = (props: Omit<DsBtnProps, 'variant'>) => <DsButton variant="secondary" {...props} />
export const DsBtnGhost = (props: Omit<DsBtnProps, 'variant'>) => <DsButton variant="ghost" {...props} />
export const DsBtnDanger = (props: Omit<DsBtnProps, 'variant'>) => <DsButton variant="danger" {...props} />

// 旧 ui.tsx 兼容导出（让现有页面不崩）
export function Card(props: HTMLAttributes<HTMLDivElement>) {
  return <DsCard {...(props as any)} />
}
