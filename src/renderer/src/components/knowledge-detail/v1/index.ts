/**
 * knowledge-detail/v1 — 知识详情子组件 barrel
 *
 * 版式来源：tdsf-linux-redesign/pages/knowledge-detail.html
 *
 * 导出：
 * - detail-parts：CodeBlock + CardHead
 * - KnowledgeDetailSidebar：右栏（目录 / 置信度 / 元信息）+ MetaRow 类型
 *
 * 阶段 F4 删掉了 detail-data.ts（设计稿示例目录 / 诊断步骤 / 示例元信息 / 关联知识 / FIX_* 命令块）：
 * 页面只渲染 kbGet 拿到的真实条目，拿不到就是空态。
 */
export type { MetaRow } from './KnowledgeDetailSidebar'
export { CodeBlock, CardHead } from './detail-parts'
export { KnowledgeDetailSidebar } from './KnowledgeDetailSidebar'
