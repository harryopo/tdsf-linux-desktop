/**
 * KnowledgeDetailPage v1 — 类型定义 + 示例数据（1:1 来自设计稿）
 *
 * 设计稿：tdsf-linux-redesign/pages/knowledge-detail.html
 *
 * 数据（严格来自设计稿示例，非 mock）：
 * - TOC_ITEMS：本页目录 6 项
 * - DIAGNOSE_STEPS：诊断步骤 4 步
 * - META_ROWS：元信息 6 行
 * - RELATED_ITEMS：关联知识 3 项
 * - FIX_BEFORE / FIX_AFTER / FIX_RELOAD_CMD / VERIFY_CMD：解决方案对比 + 重载命令 + 验证命令
 */

/** 目录项类型 */
export interface TocItem {
  num: string
  label: string
  target: string
}

/** 诊断步骤类型 */
export interface DiagnoseStep {
  num: number
  title: string
  desc: string
  code: string
  result?: string
}

/** 关联知识项类型 */
export interface RelatedItem {
  /** 知识 ID（用于点击跳转） */
  id: string
  /** 标题 */
  title: string
  /** 元信息（如 KB-NGINX-015 · 匹配 87%） */
  meta: string
}

/** 元信息行类型 */
export interface MetaRow {
  key: string
  val: string
  mono?: boolean
  alert?: boolean
}

/** 示例：目录 6 项 */
export const TOC_ITEMS: TocItem[] = [
  { num: '01', label: '问题描述', target: 'sec-1' },
  { num: '02', label: '根因分析', target: 'sec-2' },
  { num: '03', label: '诊断步骤', target: 'sec-3' },
  { num: '04', label: '解决方案', target: 'sec-4' },
  { num: '05', label: '验证方法', target: 'sec-5' },
  { num: '06', label: '反馈', target: 'sec-6' },
]

/** 示例：诊断步骤 4 步 */
export const DIAGNOSE_STEPS: DiagnoseStep[] = [
  {
    num: 1,
    title: '查看当前 worker_connections 配置',
    desc: '检查 Nginx 主配置文件中的 events 块设置',
    code: `# 查看 events 块配置
grep -A 3 'events' /etc/nginx/nginx.conf

# 预期输出：
# events {
#     worker_connections  1024;  ← 默认值偏低
# }`,
  },
  {
    num: 2,
    title: '检查系统文件描述符上限',
    desc: 'worker_connections 受限于 ulimit -n，需确认系统级限制',
    code: `# 查看当前 shell 的文件描述符限制
ulimit -n
# 输出: 1024  ← 偏低，需提升

# 查看 Nginx master 进程的实际限制
cat /proc/$(pgrep -f 'nginx: master' | head -1)/limits | grep 'open files'`,
  },
  {
    num: 3,
    title: '监控当前连接数',
    desc: '实时观察 Nginx 连接数是否逼近上限',
    code: `# 查看 Nginx 状态模块（需启用 stub_status）
curl http://127.0.0.1/nginx_status
# Active connections: 980  ← 逼近 1024 上限
# server accepts handled requests
#  123456 123456 987654
# Reading: 0 Writing: 3 Waiting: 977

# 或用 ss 统计 ESTAB 连接数
ss -s`,
    result: 'Active connections 980 逼近 1024 上限，Waiting 连接堆积，确认 worker_connections 不足。',
  },
  {
    num: 4,
    title: '检查错误日志确认',
    desc: '在 error.log 中搜索连接超限相关错误',
    code: `# 搜索连接超限错误
grep "accept() failed" /var/log/nginx/error.log | tail -5

# 预期输出：
# 2026-07-15 14:23:01 [alert] 1234#0: accept4() failed (24: Too many open files)
# 2026-07-15 14:23:02 [alert] 1234#0: accept4() failed (24: Too many open files)`,
  },
]

/** 示例：元信息 6 行 */
export const META_ROWS: MetaRow[] = [
  { key: '知识 ID', val: 'KB-NGINX-014', mono: true },
  { key: '分类', val: 'Web 服务器 / Nginx' },
  { key: '严重级别', val: '中危', alert: true },
  { key: '创建时间', val: '2026-06-08', mono: true },
  { key: '修订次数', val: '7 次' },
  { key: '证据来源', val: '官方文档 + 实践' },
]

/** 示例：关联知识 3 项（含 id 用于点击跳转详情） */
export const RELATED_ITEMS: RelatedItem[] = [
  { id: 'KB-NGINX-015', title: 'Nginx keepalive_timeout 调优', meta: 'KB-NGINX-015 · 匹配 87%' },
  { id: 'KB-SYS-003', title: 'Linux 文件描述符详解', meta: 'KB-SYS-003 · 匹配 81%' },
  { id: 'KB-NGINX-021', title: 'Nginx upstream 后端健康检查', meta: 'KB-NGINX-021 · 匹配 76%' },
]

/** 解决方案 - 调整前（默认） */
export const FIX_BEFORE = `# /etc/nginx/nginx.conf
events {
    worker_connections  1024;
}

# ulimit -n
1024`

/** 解决方案 - 调整后（推荐） */
export const FIX_AFTER = `# /etc/nginx/nginx.conf
events {
    worker_connections  10240;
    use epoll;
}

# /etc/security/limits.conf
* soft nofile 65535
* hard nofile 65535`

/** 解决方案 - 重载命令 */
export const FIX_RELOAD_CMD = `# 1. 测试配置语法
nginx -t

# 2. 重新加载 Nginx（平滑重启，不中断连接）
nginx -s reload

# 3. 重新登录 shell 使 limits.conf 生效，或手动设置
ulimit -n 65535

# 4. 验证 Nginx worker 进程的新限制
cat /proc/$(pgrep -f 'nginx: worker' | head -1)/limits | grep 'open files'
# 输出: Max open files  65535  65535  files`

/** 验证方法 - 压测命令 */
export const VERIFY_CMD = `# 使用 ab (Apache Bench) 压测，模拟 5000 并发
ab -n 50000 -c 5000 -k http://127.0.0.1/

# 压测期间监控 Nginx 状态
watch -n 1 'curl -s http://127.0.0.1/nginx_status | grep Active'

# 压测后检查 error.log 是否有连接超限错误
grep "accept() failed" /var/log/nginx/error.log | wc -l
# 输出: 0  ← 零报错，调优成功`
