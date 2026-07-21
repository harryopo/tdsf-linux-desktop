/**
 * decision-detail-sample — DecisionDetailPage 测试夹具
 *
 * 用途：
 * - 仅在测试用例 / Storybook / 开发预览中使用
 * - 运行时（DecisionDetailPage）不再加载此 mock 数据
 *   （spec REMOVED Requirements：mock 数据仅保留在测试用例中）
 *
 * 数据全部为虚构演示值，不涉及真实生产数据。
 */
import type { DecisionCard } from '@shared/models'

/**
 * 构建示例 DecisionCard，用于：
 * 1. 单元测试 / Storybook 演示
 * 2. typecheck 时的 fixture
 *
 * 注意：运行时（DecisionDetailPage.tsx）不再调用此函数，
 * IPC 不可用 / 决策不存在时改为显示 EmptyState 提示。
 */
export function buildSampleDecisionCard(id: string): DecisionCard {
  const now = Date.now()
  return {
    id: id || 'DEC-087',
    problem: 'nginx 进程 CPU 占用异常飙升至 68%',
    hypothesis: 'nginx worker_processes 配置过低 + access_log 未压缩导致 IO 阻塞',
    evidences: [
      {
        id: 'ev-001',
        source: 'log',
        sourceDetail: '/var/log/nginx/error.log',
        content: '2026-07-21 14:23:18 [error] 1234#0: *567 worker process exited on signal 9',
        drainMatch: 0.92,
        sourcePrior: 0.85,
        confidence: 0.88,
        timestamp: now - 60000,
        verified: true,
      },
      {
        id: 'ev-002',
        source: 'metric',
        sourceDetail: 'prometheus:node_cpu_seconds_total',
        content: 'CPU usage 68% (user 52% / sys 16%) · 持续 5 分钟',
        drainMatch: 0.78,
        sourcePrior: 0.90,
        confidence: 0.85,
        timestamp: now - 55000,
        verified: true,
      },
      {
        id: 'ev-003',
        source: 'command',
        sourceDetail: 'nginx -T 2>&1 | grep worker_processes',
        content: 'worker_processes 4;  # 实际 CPU 核数 8',
        drainMatch: 0.95,
        sourcePrior: 0.95,
        confidence: 0.92,
        timestamp: now - 50000,
        verified: true,
      },
      {
        id: 'ev-004',
        source: 'config',
        sourceDetail: '/etc/nginx/nginx.conf',
        content: 'access_log /var/log/nginx/access.log;  # 未启用 buffer/gzip',
        drainMatch: 0.88,
        sourcePrior: 0.92,
        confidence: 0.87,
        timestamp: now - 48000,
        verified: true,
      },
      {
        id: 'ev-005',
        source: 'knowledge',
        sourceDetail: 'KB-NGINX-2024-014',
        content: 'nginx 高 CPU 排查指南：worker_processes 与 CPU 核数对齐 + access_log buffer',
        drainMatch: 0.82,
        sourcePrior: 0.80,
        confidence: 0.78,
        timestamp: now - 45000,
        verified: false,
      },
      {
        id: 'ev-006',
        source: 'log',
        sourceDetail: '/var/log/nginx/access.log',
        content: '最近 5 分钟 12.4k 请求 · 平均响应 180ms · P99 1.2s',
        drainMatch: 0.75,
        sourcePrior: 0.85,
        confidence: 0.80,
        timestamp: now - 42000,
        verified: true,
      },
    ],
    confidence: 0.87,
    trident: {
      dangerScore: 0.85,
      idempotentScore: 0.70,
      relevanceScore: 0.92,
      compositeScore: 0.84,
      source: 'hybrid',
    },
    risk: {
      level: 'MEDIUM',
      score: 42,
      matchedRules: ['R-003', 'R-007'],
      description: '修改 nginx 配置需重启服务，影响线上请求',
      requireConfirmation: true,
      blocked: false,
    },
    fixCommand: 'sudo sed -i "s/worker_processes 4/worker_processes 8/" /etc/nginx/nginx.conf && sudo nginx -t && sudo systemctl reload nginx',
    fixDescription: '调整 worker_processes 至 8（与 CPU 核数对齐）+ reload 而非 restart 保持连接',
    rollbackCommand: 'sudo sed -i "s/worker_processes 8/worker_processes 4/" /etc/nginx/nginx.conf && sudo nginx -t && sudo systemctl reload nginx',
    status: 'approved',
    timestamp: now - 30000,
    sessionId: 'sess-preview-001',
  }
}
