/**
 * 主页组件 - HomePage
 *
 * 职责：
 * - 工作台主页，提供"终端"和"监控"两个视图切换
 * - 终端视图：多标签终端（TerminalTabs）
 * - 监控视图：实时监控面板（MonitorPanel）
 * - 顶部 Tab 切换，苹果极简风格
 *
 * 布局：
 * ┌─────────────────────────────────────┐
 * │  [终端] [监控]                       │  ← Tab 切换栏
 * ├─────────────────────────────────────┤
 * │                                     │
 * │       终端 / 监控面板内容             │
 * │                                     │
 * └─────────────────────────────────────┘
 */
import { useState, useCallback } from 'react'
import { Tabs } from 'antd'
import { CodeOutlined, DashboardOutlined } from '@ant-design/icons'
import TerminalTabs from '../terminal/TerminalTabs'
import MonitorPanel from '../monitor/MonitorPanel'
import './HomePage.css'

/** 视图类型 */
type ViewType = 'terminal' | 'monitor'

/** HomePage 主页 */
const HomePage: React.FC = () => {
  /** 当前激活的视图 */
  const [activeView, setActiveView] = useState<ViewType>('terminal')

  /** Tab 切换回调 */
  const handleChange = useCallback((key: string) => {
    setActiveView(key as ViewType)
  }, [])

  return (
    <div className="home-page">
      {/* ===== 视图切换 Tab ===== */}
      <div className="home-page-tabs">
        <Tabs
          activeKey={activeView}
          onChange={handleChange}
          items={[
            {
              key: 'terminal',
              label: (
                <span className="home-tab-label">
                  <CodeOutlined />
                  <span>终端</span>
                </span>
              ),
            },
            {
              key: 'monitor',
              label: (
                <span className="home-tab-label">
                  <DashboardOutlined />
                  <span>监控</span>
                </span>
              ),
            },
          ]}
        />
      </div>

      {/* ===== 内容区 ===== */}
      <div className="home-page-content">
        {/* 终端视图：始终保留挂载，仅隐藏，避免终端实例销毁 */}
        <div
          className="home-page-view"
          style={{ display: activeView === 'terminal' ? 'flex' : 'none' }}
        >
          <TerminalTabs />
        </div>

        {/* 监控视图：始终保留挂载，仅隐藏 */}
        {/* 始终挂载确保监控数据事件监听器不会因切换而丢失首批数据 */}
        <div
          className="home-page-view"
          style={{ display: activeView === 'monitor' ? 'flex' : 'none' }}
        >
          <MonitorPanel />
        </div>
      </div>
    </div>
  )
}

export default HomePage
