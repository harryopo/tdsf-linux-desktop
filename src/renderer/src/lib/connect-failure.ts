/**
 * 连接失败话术分类（2026-10-15 全维度系统审查 F3）
 *
 * 病根：两处连接收尾（useServerConnect、SSH 设置页）都直接
 * `连接失败: ${err.message}`，而主进程往这边透传的是 ssh2 的英文原文
 * （"All configured authentication methods failed"、"Timed out while waiting for handshake"、
 * "connect ECONNREFUSED 10.0.0.1:22"）。本产品的定位是"帮 Linux 初学者不怕命令行"，
 * 这句话对用户等于没说——他不知道该改端口、改口令还是去问网管。
 *
 * 口径：
 * - 分类表按**主进程真实会抛出的字符串**取（connection-manager 的中文话术 + ssh2 的英文原文），
 *   不是凭空写的正则集合；
 * - 认不出来的一律保留原文，不硬编一个原因给用户（把未知说成已知，比不给建议更糟）；
 * - 两处连接路径共用这一份，避免又长第二张表（审查里"多真相源"是根源 B）。
 */

export interface ConnectFailure {
  /** 这一类失败的人话名 */
  label: string
  /** 下一步该做什么（初学者能照着做） */
  nextStep: string
  /** 原文（保留在末尾，便于报障与自查） */
  raw: string
}

/**
 * 分类规则：patterns 里任意一条命中就算这一类（大小写不敏感）。
 * **顺序就是优先级**——越具体的越在前。跳板机的原文会把内层原因一起带出来
 * （"跳板机连接失败: connect ECONNREFUSED 10.0.0.9:22"），先判通用网络错
 * 就会把它归成"地址或端口不通"，用户去查目标主机端口，而真正不通的是第一跳。
 */
const RULES: Array<{ label: string; nextStep: string; patterns: string[] }> = [
  {
    label: '跳板机这一跳失败',
    nextStep: '先单独连一次跳板机；跳板机能通再回头查目标主机，别把两跳的错混成一个',
    patterns: ['跳板机'],
  },
  {
    label: '主机密钥对不上',
    nextStep:
      '这台服务器可能重装过系统或换过密钥，也可能正被中间人截获。请先与服务器管理员核对指纹，不要在没核对前继续连接',
    patterns: ['主机密钥', 'host key', '@revoked', '指纹'],
  },
  {
    label: '用户名或凭据不对',
    nextStep: '检查用户名、口令或私钥路径；用同一台机器先用其他 SSH 客户端试一次，确认账号能登录',
    patterns: [
      'All configured authentication methods failed',
      'Unable to parse private key',
      '读取私钥文件失败',
      '密码认证需要提供 password',
      '私钥认证需要提供',
      'Invalid key',
      'Too many authentication failures',
    ],
  },
  {
    label: '地址或端口不通',
    nextStep: '先确认 IP 与端口对不对，再让服务器侧放行 22 端口（或你自定义的端口）',
    patterns: ['ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH', 'ENOTFOUND', 'EADDRNOTAVAIL', 'connect failed'],
  },
  {
    label: '连上了但握手超时',
    nextStep: '多半是服务器负载高或网络抖动；把连接超时调大一点再试，仍不行就在服务器上看 sshd 是否还在接受新连接',
    patterns: ['Timed out while waiting for handshake', 'SSH 连接超时', 'ETIMEDOUT', 'timeout', '超时'],
  },
]

/**
 * 把一条连接错误翻成"是什么 + 下一步"。
 * @param raw err.message 原文（已按 IPC 约定剥掉 Electron 的包装前缀）
 */
export function describeConnectFailure(raw: string): ConnectFailure {
  const text = (raw || '').trim()
  const lower = text.toLowerCase()
  for (const r of RULES) {
    if (r.patterns.some((p) => lower.includes(p.toLowerCase()))) {
      return { label: r.label, nextStep: r.nextStep, raw: text }
    }
  }
  return { label: '原因未识别', nextStep: '把下面这句原文发给服务器管理员或看「系统日志」', raw: text }
}

/** 界面用的一行文案（toast / 状态条都够短；原文跟在后面，报障时不丢线索） */
export function connectFailureText(raw: string): string {
  const f = describeConnectFailure(raw)
  if (f.label === '原因未识别') return `连接失败：${f.raw || '未知原因'}`
  return `连接失败：${f.label}。下一步：${f.nextStep}（原文：${f.raw}）`
}
