/**
 * SettingsLayout — 设置布局（嵌套路由父级）
 *
 * 规矩：
 * - 标题栏归各子页自己（PageHeader 必须是子页第一个节点，位置/字号与其他模块一致），
 *   所以这一层不能再给子页容器加任何内距，否则左上角会整体下移右移
 * - 左栏 220px 常驻，项数 = router 里 SettingsLayout 的嵌套子路由数，一一对应
 * - 右侧 Outlet 子路由出口（/settings 根路径渲染 SettingsPage 目录页）
 * - 滚动由各子页正文容器承担，本层不出滚动条
 *
 * 无障碍：NavLink(<a>) 自带 aria-current="page"（激活态）+ 键盘可访问；
 *         prefers-reduced-motion 禁用按压动画
 */
import { NavLink, Outlet } from 'react-router-dom'
import { cn } from '@/components/trae/utils'
import { SETTINGS_SECTIONS } from './settings-sections'
import './Settings.css'

export function SettingsLayout() {
  return (
    <main className="set-page" style={{ height: '100%', overflow: 'hidden' }}>
      {/* ====== Two Column Layout（左 nav 220px + 右 Outlet）====== */}
      <div className="set-layout">
        {/* Left Nav：独立卡片（边框 + 圆角 + padding 8px），sticky 跟随滚动 */}
        <aside className="set-nav">
          {SETTINGS_SECTIONS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              data-dom-id={item.domId}
              className={({ isActive }) =>
                cn('set-nav__item btn-press', isActive && 'is-active')
              }
            >
              <>
                <item.icon className="di-16" />
                <span>{item.label}</span>
              </>
            </NavLink>
          ))}
        </aside>

        {/* Right Panel：子路由出口（/settings 根路径渲染 SettingsPage 目录页） */}
        <main className="set-panel">
          <Outlet />
        </main>
      </div>
    </main>
  )
}
