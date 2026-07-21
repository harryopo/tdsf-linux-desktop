/**
 * knowledge-detail/v1 — 知识详情子组件 barrel
 *
 * 设计稿：tdsf-linux-redesign/pages/knowledge-detail.html
 *
 * 导出：
 * - detail-data：类型 + 示例数据（TOC_ITEMS / DIAGNOSE_STEPS / META_ROWS / RELATED_ITEMS / FIX_*）
 * - detail-parts：CodeBlock + CardHead
 * - KnowledgeDetailSidebar：右栏 4 张卡片
 */
export type {
  TocItem,
  DiagnoseStep,
  RelatedItem,
  MetaRow,
} from './detail-data'
export {
  TOC_ITEMS,
  DIAGNOSE_STEPS,
  META_ROWS,
  RELATED_ITEMS,
  FIX_BEFORE,
  FIX_AFTER,
  FIX_RELOAD_CMD,
  VERIFY_CMD,
} from './detail-data'
export { CodeBlock, CardHead } from './detail-parts'
export { KnowledgeDetailSidebar } from './KnowledgeDetailSidebar'
