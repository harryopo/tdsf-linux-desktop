/**
 * 设置页面组件 - SettingsPage
 *
 * 职责：
 * - 5 个 Tab 切换：LLM 配置 / SSH 默认配置 / 风险规则 / 资产标签 / 关于
 * - 四个配置区块从 SettingsSections 导入
 * - AboutSection 直接内联（内容较少）
 *
 * 苹果极简风格：
 * - 左侧垂直 Tab 导航，右侧表单区
 * - 细线条分割，大量留白，8px 圆角
 */
import { useState } from 'react'
import { Tabs, Divider, Typography } from 'antd'
import {
  ApiOutlined,
  CloudServerOutlined,
  SafetyOutlined,
  TagsOutlined,
  InfoCircleOutlined,
} from '@ant-design/icons'
import { LlmConfigSection, SshConfigSection, RiskRulesSection, AssetTagsSection } from './SettingsSections'
import './SettingsPage.css'

const { Text, Paragraph } = Typography

/** 设置页 Tab 项类型 */
type SettingsTab = 'llm' | 'ssh' | 'risk' | 'tags' | 'about'

/** AboutSection 关于区块 */
const AboutSection: React.FC = () => (
  <div className="settings-section">
    <div className="settings-section-header">
      <h3>关于 TDSF-Linux Desktop</h3>
    </div>
    <Paragraph>
      <Text strong>TDSF-Linux Desktop</Text> 是面向 Linux 运维的人机协同可信决策桌面助手。
    </Paragraph>
    <Divider />
    <div className="settings-about-info">
      <div className="settings-about-row">
        <Text type="secondary">版本</Text>
        <Text>0.1.0</Text>
      </div>
      <div className="settings-about-row">
        <Text type="secondary">技术栈</Text>
        <Text>Electron 30 + React 18 + TypeScript 5.4 + Ant Design 5</Text>
      </div>
      <div className="settings-about-row">
        <Text type="secondary">核心机制</Text>
        <Text>证据置信度 / Ground-Check / 自适应采样 / 4层风险控制 / 双推理 / 知识双轨制</Text>
      </div>
      <div className="settings-about-row">
        <Text type="secondary">参赛</Text>
        <Text>2026 火山杯 Agent 创新大赛</Text>
      </div>
    </div>
  </div>
)

/** SettingsPage 设置页面 */
const SettingsPage: React.FC = () => {
  /** 当前激活的 Tab */
  const [activeTab, setActiveTab] = useState<SettingsTab>('llm')

  return (
    <div className="settings-page">
      <Tabs
        activeKey={activeTab}
        onChange={(key) => setActiveTab(key as SettingsTab)}
        tabPosition="left"
        className="settings-tabs"
        items={[
          {
            key: 'llm',
            label: (
              <span className="settings-tab-label">
                <ApiOutlined />
                <span>LLM 配置</span>
              </span>
            ),
            children: <LlmConfigSection />,
          },
          {
            key: 'ssh',
            label: (
              <span className="settings-tab-label">
                <CloudServerOutlined />
                <span>SSH 默认配置</span>
              </span>
            ),
            children: <SshConfigSection />,
          },
          {
            key: 'risk',
            label: (
              <span className="settings-tab-label">
                <SafetyOutlined />
                <span>风险规则</span>
              </span>
            ),
            children: <RiskRulesSection />,
          },
          {
            key: 'tags',
            label: (
              <span className="settings-tab-label">
                <TagsOutlined />
                <span>资产标签</span>
              </span>
            ),
            children: <AssetTagsSection />,
          },
          {
            key: 'about',
            label: (
              <span className="settings-tab-label">
                <InfoCircleOutlined />
                <span>关于</span>
              </span>
            ),
            children: <AboutSection />,
          },
        ]}
      />
    </div>
  )
}

export default SettingsPage
