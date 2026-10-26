/**
 * 递归删除不许顺着符号链接删到目标（#241）
 *
 * 实测（GNU coreutils）：`rm -rf /tmp/a/link/`（link -> /tmp/victim）会把 victim 里的
 * 内容删光——尾斜杠让 rm 跟进了链接。文件面板的"删除目录"走的就是远端 `rm -rf`，
 * 只过路径字符串闸拦不住：链接本身不在 /etc 之类的前缀下。
 *
 * 判据：递归删除只接受**绝对且规范**的路径；远端 realpath 与字面路径不一致
 * （符号链接 / `..` / 非规范写法）一律拒绝，让用户去终端自己处理。
 */
import { describe, it, expect } from 'vitest'
import { assertDeleteTargetNotSymlink } from '../../src/main/services/ssh/remote-write-guard'

describe('递归删除的符号链接闸（#241）', () => {
  it('绝对路径且 realpath 与字面一致 → 放行', () => {
    expect(() => assertDeleteTargetNotSymlink('/home/harry/logs', '/home/harry/logs')).not.toThrow()
  })

  it('尾斜杠会被 normalize 掉：/home/harry/logs/ 与 realpath 一致仍放行', () => {
    expect(() =>
      assertDeleteTargetNotSymlink('/home/harry/logs/', '/home/harry/logs'),
    ).not.toThrow()
  })

  it('realpath 指向别处（符号链接）→ 拒绝，并说出解析后的路径', () => {
    expect(() =>
      assertDeleteTargetNotSymlink('/home/harry/logs', '/tmp/victim'),
    ).toThrow(/\/tmp\/victim/)
  })

  it('相对路径一律拒绝（远端 cwd 不可知，折叠成"看起来安全"的路径等于拿未知当许可）', () => {
    expect(() => assertDeleteTargetNotSymlink('logs', 'logs')).toThrow(/绝对路径/)
  })

  it('`..` 折叠后与 realpath 不一致 → 拒绝（同一条"非规范写法"规则）', () => {
    expect(() =>
      assertDeleteTargetNotSymlink('/home/harry/../victim', '/home/victim'),
    ).not.toThrow()
    // 字面路径 normalize 后与 realpath 不同（远端把中间段做成了链接）→ 拒
    expect(() =>
      assertDeleteTargetNotSymlink('/home/harry/../victim', '/srv/victim'),
    ).toThrow(/符号链接|非规范/)
  })
})
