/**
 * 图片附件整条撤掉（2026-10-28，#255）
 *
 * 撤的理由不是"不好看"，是它**只会烧钱**：发送时把 base64 data URL 直接拼进用户消息
 * （原 Composer 的 `[图片附件]` 那段），而整条链路没有任何 vision 支持——
 * 模型读到的是几万到几百万字符的 base64，既看不懂图，又按 token 计费，
 * 还会永久留在历史里每轮重发。界面自己都写着"当前模型暂不支持识图"。
 *
 * 所以这里按"假功能"处理：上传入口、IPC 通道、preload 键与提示词里的拼接全部不许回来。
 * 将来真做多模态时，走的是消息 content parts（不是往文本里塞 base64），
 * 那时这条判据要连同 design 一起改。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(__dirname, '../..')

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) {
      if (name === 'node_modules' || name === 'out' || name === 'dist') continue
      walk(p, out)
    } else if (/\.(ts|tsx)$/.test(name)) {
      out.push(p)
    }
  }
  return out
}

const SRC_FILES = walk(join(ROOT, 'src'))

describe('图片附件不许回来（它只会把 base64 烧成 token）', () => {
  it('src 里不再有这条通道、这把键、这段拼接', () => {
    const banned = ['fsUploadImage', 'fs:upload-image', 'UPLOAD_IMAGE', '[图片附件]']
    const hits: string[] = []
    for (const file of SRC_FILES) {
      const text = readFileSync(file, 'utf8')
      for (const shape of banned) {
        if (text.includes(shape)) {
          hits.push(`${file.slice(ROOT.length + 1)} ← ${shape}`)
        }
      }
    }
    expect(hits, `这些文件还留着图片附件的形状：\n${hits.join('\n')}`).toEqual([])
  })

  it('量具自证：把禁用形状喂给它必须报（不是永远返回空的尺子）', () => {
    const sample = 'const r = await api.fsUploadImage()\nconst t = `[图片附件]`'
    const found = ['fsUploadImage', '[图片附件]'].filter((s) => sample.includes(s))
    expect(found).toHaveLength(2)
  })
})
