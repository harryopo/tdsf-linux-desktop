/**
 * 脱敏规则的 Windows 形态判据（2026-10-09 安全审查 S5 / P1-2）
 *
 * 原规则集在 POSIX 形态上是好的，但日志里真正的凭据形态是 Windows 的：
 * 盘符路径、JSON.stringify 之后成对的反斜杠、连接串里内联的账号密码、
 * Authorization: Basic、sshpass -p…、token=/passphrase: 这类键名。
 * 报告里那批样本实测全部 MISS，所以这里把它们落成 fixture 并断言全 HIT。
 *
 * 两半都要有：
 * - 命中半：每条样本的敏感值必须从结果里消失（否则规则等于没写）；
 * - 阴性对照（不该命中的半）：正常日志必须逐字节原样通过——
 *   乱打码会把「现场查不到」换成「现场看不懂」，那是另一种故障。
 */
import { describe, it, expect } from 'vitest'
import {
  redactSecrets,
  containsSensitivePath,
  listRedactRules,
} from '../../src/main/core/agent/providers/redact'

interface HitCase {
  label: string
  input: string
  /** 结果里不许再出现的原文片段 */
  mustVanish: string[]
}

const HIT_CASES: HitCase[] = [
  {
    label: 'Windows 私钥路径',
    input: '读取私钥失败：C:\\Users\\harryopo\\.ssh\\id_rsa 不存在',
    mustVanish: ['harryopo', 'id_rsa'],
  },
  {
    label: 'JSON 转义过的 userData 存储文件',
    input: JSON.stringify({ keyPath: 'C:\\Users\\x\\.tdsf\\secure-storage.json' }),
    mustVanish: ['secure-storage', 'harryopo'],
  },
  {
    label: 'UNC 共享里的证书',
    input: '从 \\\\fileserver\\share\\tls\\server.pem 载入证书失败',
    mustVanish: ['fileserver', 'server.pem'],
  },
  {
    label: '连接串内联口令',
    input: '连不上 postgres://admin:S3cr3tPw@198.51.100.7/tdsf',
    mustVanish: ['S3cr3tPw'],
  },
  {
    label: 'Authorization Basic 头',
    input: '请求头 Authorization: Basic QWxhZGRpbjpPcGVuU2VzYW1l 被拒绝',
    mustVanish: ['QWxhZGRpbjpPcGVuU2VzYW1l'],
  },
  {
    label: 'sshpass 明文口令',
    input: "执行 sshpass -p'TopSecret1' ssh root@10.0.0.5 uptime",
    mustVanish: ['TopSecret1'],
  },
  {
    label: 'token 赋值（原来只有 api_key/password 两族）',
    input: '刷新失败 token=abcdefghij1234567890XYZ',
    mustVanish: ['abcdefghij1234567890XYZ'],
  },
  {
    label: 'passphrase 冒号形态',
    input: 'passphrase: Sup3rPass2026',
    mustVanish: ['Sup3rPass2026'],
  },
  {
    label: 'GitHub token 前缀',
    // 拆成相邻字面量：写成完整形态会让 GitHub 推送扫描当真报警（删掉也不会自动关）
    input: '推送用了 ' + 'ghp_' + '_A1b2C3d4E5f6G7h8I9j0K1L2M3N4O5P6Q7R8'.slice(1),
    mustVanish: ['A1b2C3d4E5f6G7h8I9j0K1L2M3N4O5P6Q7R8'],
  },
  {
    label: 'POSIX 私钥路径（原有能力不许退化）',
    input: 'chmod 600 /home/student/.ssh/id_ed25519',
    mustVanish: ['id_ed25519'],
  },
  {
    label: 'OpenAI key（原有能力不许退化）',
    input: 'LLM 调用被拒：' + 'sk-' + 'abcdefghijklmnopqrstuvwxyz123456',
    mustVanish: ['abcdefghijklmnopqrstuvwxyz123456'],
  },
]

/** 正常日志样本：必须逐字节原样通过 */
const PASS_THROUGH_CASES: string[] = [
  '会话 3f2a8b1c-4d5e-6f70-8a9b-0c1d2e3f4a5b 已建立，端口 22，用时 1200ms',
  '校验 sha512=3a7f9c2b1d0e4f5a6b7c8d9e0f1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c 通过',
  'LLM 参数 max_tokens=1024 temperature=0.2',
  'POST /api/v1/knowledge 返回 200，耗时 12ms',
  'C:\\Windows\\System32\\drivers\\etc\\hosts 里没有该条目',
  '读取 /var/log/syslog 最后 200 行',
  '磁盘使用率 91%，阈值 85%，会话 s-1 正常采集',
  '用量统计 token_count=512（prompt 400 + completion 112），tokenizer=cl100k',
]

describe('脱敏规则覆盖 Windows 形态', () => {
  for (const c of HIT_CASES) {
    it(`命中：${c.label}`, () => {
      const out = redactSecrets(c.input)
      for (const secret of c.mustVanish) {
        expect(out, `敏感值仍然存在：${secret}`).not.toContain(secret)
      }
      expect(out).not.toBe(c.input)
    })
  }

  for (const input of PASS_THROUGH_CASES) {
    it(`不误伤：${input.slice(0, 24)}…`, () => {
      expect(redactSecrets(input)).toBe(input)
    })
  }

  it('命中数能被统计出来（闸的观测口，不是只改字符串）', () => {
    const { text, stats } = redactSecrets('token=abcdefghij1234567890XYZ C:\\Users\\x\\.ssh\\id_rsa', {
      returnStats: true,
    })
    expect(text).not.toContain('abcdefghij1234567890XYZ')
    expect(stats.total, '两条敏感值应各计一次').toBeGreaterThanOrEqual(2)
    expect(Object.keys(stats.hits).length).toBeGreaterThanOrEqual(2)
  })

  it('规则清单从规则表现取，不再手写第二份名单', () => {
    const rules = listRedactRules()
    const names = rules.map((r) => r.name)
    expect(new Set(names).size, '规则名不能重复').toBe(names.length)
    // 数字要人工复核后才会变：加规则时这条会红，逼着补 fixture 而不是静默漂移
    // 20 = 18 + pem-private-key-unterminated（半截私钥块）+ cjk-secret-label（「密码是XXX」），
    // 两条的样本在 tests/security/hostile-write-entry-gate.test.ts 的 B 组
    expect(names.length).toBe(20)
    for (const need of [
      'windows-sensitive-path',
      'url-credentials',
      'authorization-header',
      'sshpass-inline',
      'sensitive-key-assign',
      'vendor-token-prefix',
      'pem-private-key-unterminated',
      'cjk-secret-label',
    ]) {
      expect(names, `缺少规则 ${need}`).toContain(need)
    }
  })

  it('containsSensitivePath 认得出 Windows 路径（UI 提示用的那半）', () => {
    expect(containsSensitivePath('C:\\Users\\x\\.ssh\\id_rsa')).toBe(true)
    expect(containsSensitivePath('/home/x/.ssh/id_rsa')).toBe(true)
    expect(containsSensitivePath('C:\\Windows\\Temp\\build.log')).toBe(false)
  })
})
