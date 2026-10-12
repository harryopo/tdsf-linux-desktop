/**
 * /dev/null 这类"丢弃目的地"不再被当成覆写块设备（2026-10-12 真机反馈）
 *
 * 起因：用户实测"很多命令不让运行"。调研量到全仓 196 处往 /dev/null 重定向
 * （`2>/dev/null` 是查错时的标准写法），而命令闸有两处会把它判成危险：
 *   - checkDeviceDestruction：写目的地 startsWith('/dev/') → '重定向覆写块设备'
 *   - isProtectedWriteTarget：PROTECTED_WRITE_PREFIXES 收了 '/dev' → '把内容写进系统关键路径'
 * 于是 `ls -la 2>/dev/null` 这种最日常的命令在第一处就被拦死。
 *
 * 这个文件钉两端，只有正向等于没闸：
 *   1. 丢弃/回显语义的目的地（/dev/null、/dev/stdout、/dev/fd/N…）必须放行；
 *   2. 真设备（/dev/sda、/dev/nvme0n1）和绕过写法（/dev/null/../sda、/dev/nulls）
 *      必须仍然 block——白名单只能盖住精确列出的那几个，不能是前缀。
 */
import { describe, expect, it } from 'vitest'
import { evaluateCommand } from '../../src/main/core/command-gate'

/** 放行清单：命令本身无害，只是把输出丢掉或打到自己终端上 */
const ALLOW: Array<[string, string]> = [
  ['ls -la /etc 2>/dev/null', '查错时丢弃 stderr（用户实际敲的那条）'],
  ['cat /etc/hosts > /dev/null', '丢弃 stdout'],
  ['du -sh /var 2>/dev/null 1>/dev/null', '两路都丢'],
  ['make 2>&1 >/dev/null', '合并后丢弃'],
  ['grep root /etc/passwd 2>"/dev/null"', '双引号包裹'],
  ["head -1 /etc/hostname 2> '/dev/null'", '单引号包裹'],
  ['echo hello >> /dev/null', '追加剧本也丢弃'],
  ['nginx -t 2>/dev/null && echo OK', '复合命令里带丢弃'],
  ['echo hi | tee /dev/null', 'tee 到丢弃位'],
  ['truncate -s 0 /dev/null', '清空丢弃位（本来就是空文件）'],
  ['dd if=/dev/zero of=/dev/null bs=1M count=10', '教科书级无害基准'],
  ['ls 2>/dev/null > /dev/stdout', '写到自己的 stdout'],
  ['ls 1>/dev/stderr', '写到自己的 stderr'],
  ['ls 2>/dev/fd/1', '写到自己的 fd'],
  ['echo hi > /dev/tty', '打到自己终端']
]

/** 必须仍然拦下：真设备 + 想用白名单绕过去的写法 */
const BLOCK: Array<[string, string]> = [
  ['echo x > /dev/sda', '覆写整块盘'],
  ['echo x >"/dev/sda"', '引号包裹的设备'],
  ['cat disk.img > /dev/nvme0n1', '覆写 NVMe'],
  ['dd if=/dev/zero of=/dev/sda bs=1M', 'dd 写设备'],
  ['dd if=/dev/zero of=/dev/null/../sda bs=1M', '用 .. 从白名单跳回设备'],
  ['echo x > /dev/nulls', '前缀像白名单但不是'],
  ['echo x > /dev/null.conf', '后缀像白名单但不是'],
  ['echo x > /dev/sda2', '分区'],
  ['mkfs.ext4 /dev/sda1', '格式化'],
  ['echo x > /proc/sysrq-trigger', '写 proc 仍要拦'],
  ['echo 1 > /sys/block/sda/device/delete', '写 sys 仍要拦']
]

describe('命令闸对 /dev/null 的口径', () => {
  it.each(ALLOW)('放行：%s', (cmd) => {
    const v = evaluateCommand(cmd)
    expect(v.level, `被判 block：${v.reason}`).not.toBe('block')
  })

  it.each(BLOCK)('仍拦：%s', (cmd) => {
    const v = evaluateCommand(cmd)
    expect(v.level, `不该放行（reason=${v.reason}）`).toBe('block')
  })

  it('阴性对照：量具自己没坏（不含丢弃重定向的同类命令照旧判级）', () => {
    // 若这条也变 block、或整表全绿到可疑，说明 tokenizer 或本文件写法出了问题
    expect(evaluateCommand('echo x > /tmp/out.txt').level).not.toBe('block')
    expect(evaluateCommand('rm -rf /').level).toBe('block')
    expect(evaluateCommand('echo x > /etc/passwd').level).toBe('block')
  })
})
