/**
 * 编辑器多 Tab 组件 - EditorTabs（v0.8 IDE 工作台）
 *
 * 职责：
 * - 显示已打开文件列表（Tab 形式）
 * - 每个 Tab 显示文件名 + dirty 圆点 + 关闭按钮
 * - 切换 Tab 切换激活文件
 * - 关闭 Tab 调用 closeFile（自动切换相邻 Tab）
 *
 * 设计：
 * - 基于 Ant Design Tabs（type="editable-card" + hideAdd）
 * - tab key 用完整路径
 */
import { useMemo } from 'react'
import { Tabs } from 'antd'
import type { TabsProps } from 'antd'
import { useIDEStore } from '../../stores/ide-store'
import './EditorTabs.css'

/** EditorTabs 多 Tab 组件 */
const EditorTabs: React.FC = () => {
  const openFiles = useIDEStore((s) => s.openFiles)
  const activeFilePath = useIDEStore((s) => s.activeFilePath)
  const setActiveFile = useIDEStore((s) => s.setActiveFile)
  const closeFile = useIDEStore((s) => s.closeFile)

  /** Tab 项配置 */
  const items = useMemo<TabsProps['items']>(
    () =>
      openFiles.map((file) => ({
        key: file.path,
        label: (
          <span className="editor-tab-label">
            {/* dirty 圆点（未保存时显示） */}
            {file.isDirty && <span className="editor-tab-dirty" />}
            <span className="editor-tab-name">{file.name}</span>
          </span>
        ),
        closable: true,
      })),
    [openFiles]
  )

  /** 切换 Tab */
  const handleChange = (key: string) => {
    setActiveFile(key)
  }

  /** 关闭 Tab */
  const handleEdit = (targetKey: React.MouseEvent | React.KeyboardEvent | string, action: 'add' | 'remove') => {
    if (action === 'remove') {
      closeFile(String(targetKey))
    }
  }

  if (openFiles.length === 0) {
    return null
  }

  return (
    <div className="editor-tabs-container">
      <Tabs
        type="editable-card"
        hideAdd
        size="small"
        activeKey={activeFilePath ?? undefined}
        items={items}
        onChange={handleChange}
        onEdit={handleEdit}
        className="editor-tabs"
      />
    </div>
  )
}

export default EditorTabs
