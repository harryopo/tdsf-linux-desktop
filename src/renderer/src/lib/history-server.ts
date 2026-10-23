/**
 * 决策历史里"服务器"这一列的读数口径（任务 #175-①）
 *
 * 库里存的是 serverId（opaque 字符串），界面上要给人看的是名字。
 * 原先这一列塞的是 `会话 xxxx` / `'local'`，而下拉选项来自 stats.servers 里的真 serverId，
 * 两边写法不同 ⇒ 选任何一个服务器都得到空列表，还看起来像"确实没有记录"。
 * 现在显示、筛选、搜索都走 serverLabel() 这一个派生值，选项也由它派生。
 */
import type { SshConfig } from '@shared/models'

/** 这条决策根本没记是哪台机器 */
export const NO_SERVER = '未记录'
/** 下拉里代表"不按服务器筛"的那一项 */
export const ALL_SERVERS = '全部服务器'

/**
 * 把 serverId 翻成界面上那一格的文字。
 *
 * 三种情况分开，因为它们是三件不同的事实：
 * - 没有 id → 「未记录」，不编主机名；
 * - 有 id 且在服务器列表里 → 用户自己起的名字；
 * - 有 id 但列表里找不到（服务器已被删掉，或列表还没加载完）→ 显示 id 前缀，
 *   这既不是说"没记录"也不是瞎猜一个名字，只说"当时是那台，现在认不出来"。
 */
export function serverLabel(
  serverId: string | null | undefined,
  servers: readonly Pick<SshConfig, 'id' | 'name'>[]
): string {
  if (!serverId) return NO_SERVER
  const hit = servers.find((s) => s.id === serverId)
  if (hit) return hit.name
  return `服务器 ${serverId.slice(0, 8)}`
}

/** 下拉选项 = 当前这一页真能筛到的那些行，第一项是"全部" */
export function serverOptions(labels: readonly string[]): string[] {
  return [ALL_SERVERS, ...Array.from(new Set(labels))]
}
