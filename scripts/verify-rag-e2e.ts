/**
 * Sprint 7 E2E 验证脚本：混合检索（FTS5 + vec0 + RRF）
 *
 * 教学术语：
 * - E2E (End-to-End)：端到端测试，从用户输入到结果输出全链路
 * - RRF (Reciprocal Rank Fusion)：倒数排名融合，把多路检索结果合并排序
 * - BGE (BAAI General Embedding)：智源研究院开源中文 embedding 模型
 *
 * 验证目标：
 * 1. 数据库初始化（FTS5 + vec0 虚拟表）
 * 2. EmbeddingService 加载模型 + 生成向量
 * 3. 入库 5 条测试数据（带 embedding）
 * 4. hybridSearch() 混合检索
 * 5. 比较关键词 vs 语义 vs 混合三种模式结果
 */

// Mock electron 模块（ELECTRON_RUN_AS_NODE 模式下 electron 不提供 app export）
//
// 注意：此 mock 代码会被 esbuild banner 提前注入到 bundle 顶部（见 run-verify-rag-e2e.cjs），
// 否则 esbuild 会把 `import { app } from 'electron'` 编译为顶层 `require('electron')`，
// 先于普通 require 语句执行，导致 mock 拦截器注册时 electron 已被加载。
//
// 这里保留代码用于 TypeScript 类型检查，运行时由 banner 注入的版本生效。
declare const require: (id: string) => unknown
declare const process: { env: Record<string, string | undefined> }

if (typeof process !== 'undefined' && process.env.TDSF_E2E_MOCK_ELECTRON === '1') {
  // 运行时由 banner 注入的 mock 代码生效
}

import { DatabaseManager } from '../src/main/services/db/database'
import { TutorialRepository } from '../src/main/services/tutorial/tutorial-repo'
import { EmbeddingService, prefixQuery, EMBEDDING_DIM } from '../src/main/services/tutorial/embedding-service'
import { hybridSearch } from '../src/main/services/tutorial/hybrid-search'
import type { TutorialEntry } from '../src/main/services/tutorial/types'
import * as os from 'node:os'
import * as path from 'node:path'

const tmpDbPath = path.join(os.tmpdir(), `tdsf-rag-e2e-${Date.now()}.db`)
console.log(`[E2E] 临时数据库: ${tmpDbPath}`)

// 5 条测试数据（覆盖中英文、不同分类）
const testEntries: TutorialEntry[] = [
  {
    id: 'test:ssh-config',
    title: '如何配置 SSH 免密登录',
    summary: '使用 ssh-keygen 生成密钥对，并通过 ssh-copy-id 部署到远程服务器',
    source: { name: 'test', url: 'http://test/ssh', crawledAt: Date.now(), license: 'MIT', licenseUrl: '', kind: 'online-crawl' },
    category: 'security',
    tags: ['ssh', 'security', '密钥'],
    difficulty: 'intermediate',
    readingTime: 5,
    content: '## SSH 免密登录配置\n\n```bash\nssh-keygen -t ed25519\nssh-copy-id user@host\n```\n\n验证：`ssh user@host` 无需密码',
    commands: ['ssh-keygen -t ed25519', 'ssh-copy-id user@host'],
    keywords: ['ssh', '密钥', '免密', 'keygen', 'ed25519'],
    distros: [],
    createdAt: Date.now(),
    updatedAt: Date.now()
  },
  {
    id: 'test:nginx-502',
    title: 'Nginx 502 Bad Gateway 排查指南',
    summary: '502 错误通常是后端服务挂掉或超时，用 curl 和 telnet 定位',
    source: { name: 'test', url: 'http://test/nginx', crawledAt: Date.now(), license: 'MIT', licenseUrl: '', kind: 'online-crawl' },
    category: 'troubleshooting',
    tags: ['nginx', '502', 'troubleshoot'],
    difficulty: 'advanced',
    readingTime: 8,
    content: '## Nginx 502 排查\n\n```bash\ncurl -v http://localhost:8080\ntelnet 127.0.0.1 8080\n```\n\n常见原因：后端进程未启动 / 端口错误 / 防火墙拦截',
    commands: ['curl -v http://localhost:8080', 'telnet 127.0.0.1 8080'],
    keywords: ['nginx', '502', 'bad gateway', '排查', '后端'],
    distros: [],
    createdAt: Date.now(),
    updatedAt: Date.now()
  },
  {
    id: 'test:chmod',
    title: 'chmod 命令详解',
    summary: 'chmod 用于修改文件权限，支持数字模式和符号模式',
    source: { name: 'test', url: 'http://test/chmod', crawledAt: Date.now(), license: 'MIT', licenseUrl: '', kind: 'online-crawl' },
    category: 'security',
    tags: ['chmod', 'permission'],
    difficulty: 'beginner',
    readingTime: 3,
    content: '## chmod 命令\n\n```bash\nchmod 755 file.txt\nchmod u+x script.sh\n```\n\n数字模式：7=rwx, 5=rx, 4=r',
    commands: ['chmod 755 file.txt', 'chmod u+x script.sh'],
    keywords: ['chmod', '权限', 'permission', 'rwx'],
    distros: [],
    createdAt: Date.now(),
    updatedAt: Date.now()
  },
  {
    id: 'test:systemd-failed',
    title: 'systemd 服务启动失败排查',
    summary: '用 systemctl status 和 journalctl 查看服务失败原因',
    source: { name: 'test', url: 'http://test/systemd', crawledAt: Date.now(), license: 'MIT', licenseUrl: '', kind: 'online-crawl' },
    category: 'services',
    tags: ['systemd', 'service', 'fail'],
    difficulty: 'intermediate',
    readingTime: 6,
    content: '## systemd 服务失败\n\n```bash\nsystemctl status nginx\njournalctl -u nginx -n 50\n```\n\n常见错误：配置语法 / 依赖未启动 / 端口占用',
    commands: ['systemctl status nginx', 'journalctl -u nginx -n 50'],
    keywords: ['systemd', 'service', 'fail', 'status', 'journalctl'],
    distros: [],
    createdAt: Date.now(),
    updatedAt: Date.now()
  },
  {
    id: 'test:iptables-block',
    title: 'iptables 防火墙规则配置',
    summary: 'iptables 是 Linux 内核防火墙工具，可配置入站出站规则',
    source: { name: 'test', url: 'http://test/iptables', crawledAt: Date.now(), license: 'MIT', licenseUrl: '', kind: 'online-crawl' },
    category: 'networking',
    tags: ['iptables', 'firewall', 'network'],
    difficulty: 'advanced',
    readingTime: 10,
    content: '## iptables 配置\n\n```bash\niptables -A INPUT -p tcp --dport 22 -j ACCEPT\niptables -L -n -v\n```\n\n默认策略：INPUT/OUTPUT/FORWARD',
    commands: ['iptables -A INPUT -p tcp --dport 22 -j ACCEPT', 'iptables -L -n -v'],
    keywords: ['iptables', '防火墙', 'firewall', '规则', 'rule'],
    distros: [],
    createdAt: Date.now(),
    updatedAt: Date.now()
  }
]

async function main() {
  const db = DatabaseManager.getInstance(tmpDbPath)
  console.log(`[E2E] DB 可用=${db.isAvailable()} 向量扩展=${db.isVectorEnabled()}`)

  const repo = new TutorialRepository(db)

  // 1. 入库（异步带 embedding）
  console.log('\n========== 1. 入库 ==========')
  console.log('[E2E] 入库 5 条测试数据（含 embedding 生成）...')
  const insertResult = await repo.upsertManyAsync(testEntries, {
    onProgress: (cur, total) => console.log(`  [embedding] ${cur}/${total}`)
  })
  console.log(`[E2E] 入库完成: inserted=${insertResult.inserted} updated=${insertResult.updated} skipped=${insertResult.skipped}`)

  // 2. 检查 search status
  console.log('\n========== 2. 检索状态 ==========')
  const status = {
    vectorEnabled: db.isVectorEnabled(),
    embeddingModelLoaded: EmbeddingService.getInstance().isLoaded(),
    embeddingDim: EMBEDDING_DIM,
    totalEntries: repo.count()
  }
  console.log('[E2E]', status)

  // 3. 测试三种检索模式
  const queries = [
    { q: 'ssh 免密', desc: '关键词命中（FTS5 应该返回 ssh 条目）' },
    { q: '配置 SSH 免密登录', desc: '语义检索（vec0 应该返回 ssh 条目）' },
    { q: '服务起不来', desc: '语义泛化（应命中 systemd-failed）' },
    { q: '防火墙', desc: '中文关键词（应命中 iptables）' }
  ]

  console.log('\n========== 3. 混合检索测试 ==========')
  for (const { q, desc } of queries) {
    console.log(`\n--- 查询: "${q}" (${desc}) ---`)
    const queryVec = await EmbeddingService.getInstance().embed(prefixQuery(q)).catch(() => undefined)

    const results = hybridSearch(db, {
      query: q,
      queryEmbedding: queryVec,
      type: 'tutorial',
      limit: 3
    })

    console.log(`  返回 ${results.length} 条:`)
    for (const r of results) {
      console.log(`    - [${r.source}] ${(r.rrfScore * 100).toFixed(2)}% | ${r.title}`)
      console.log(`      fts=${r.ftsScore.toFixed(2)} vec=${r.vecDistance.toFixed(4)}`)
    }
  }

  // 4. 对比模式
  console.log('\n========== 4. 模式对比 ==========')
  const cmpQuery = 'ssh 配置'
  console.log(`查询: "${cmpQuery}"`)
  const cmpVec = await EmbeddingService.getInstance().embed(prefixQuery(cmpQuery)).catch(() => undefined)

  console.log('\n仅 FTS（无向量）:')
  const ftsOnly = hybridSearch(db, { query: cmpQuery, queryEmbedding: undefined, type: 'tutorial', limit: 3 })
  ftsOnly.forEach((r, i) => console.log(`  ${i + 1}. [${r.source}] ${r.title} (rrf=${(r.rrfScore * 100).toFixed(2)}%)`))

  console.log('\n仅向量（无 FTS，传空 query）:')
  if (cmpVec) {
    const vecOnly = hybridSearch(db, { query: '', queryEmbedding: cmpVec, type: 'tutorial', limit: 3 })
    vecOnly.forEach((r, i) => console.log(`  ${i + 1}. [${r.source}] ${r.title} (rrf=${(r.rrfScore * 100).toFixed(2)}%)`))
  }

  console.log('\n混合（FTS + vec）:')
  const both = hybridSearch(db, { query: cmpQuery, queryEmbedding: cmpVec, type: 'tutorial', limit: 3 })
  both.forEach((r, i) => console.log(`  ${i + 1}. [${r.source}] ${r.title} (rrf=${(r.rrfScore * 100).toFixed(2)}%)`))

  console.log(`\n✅ E2E 验证完成。临时 DB: ${tmpDbPath}`)
}

main().catch((err) => {
  console.error('[E2E] ❌ 失败:', err)
  process.exit(1)
})
