/**
 * 仓库身份单源闸（#169 / 调研 P0-3）
 *
 * 起因是一条实测：`src/main/ipc/app-update.ts` 自己写了一份 `'tdsf-linux/tdsf-linux-desktop'`，
 * 而全仓其余五处（about 页、scripts/release.ps1、README、SECURITY）都是 `harryopo/...`。
 * 那份副本是"检查更新"唯一的取数来源，于是设置→关于里那个按钮每次点都 404。
 *
 * 本文件不修那次错（改在 repo-identity.ts），它管的是"以后别再抄第二份"。
 * 全部离线可复算，不联网：真打一次 GitHub API 的取证在调研报告里手工记过。
 *
 * 判据设计说明（为什么不写成"扫所有 github.com/owner/repo"）：
 * GitHub 自己的文档站也是 github.com/<两段路径> 的形状（docs.github.com/en/rest/...），
 * 按通用形状扫会把站路当成仓库名，误报一片、然后被人加豁免关掉。所以只咬两个真形状：
 *   ① 仓库名固定为本仓、owner 却写错的那种（这次的缺陷本体）；
 *   ② 把仓库全名又抄了一遍、没走单源的那种（下一次分叉的入口）。
 */
import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import {
  GITHUB_REPO_SLUG,
  GITHUB_REPO_URL,
  GITHUB_RELEASES_PAGE,
  GITHUB_LATEST_RELEASE_API,
} from '@shared/repo-identity'
import { listSourceFiles, readSourceFile } from '../helpers/source-scan'

const ROOT = path.resolve(__dirname, '..', '..')
const SRC = path.join(ROOT, 'src')
const SHARED_MODULE = 'src/shared/repo-identity.ts'

/** 本仓仓库名（owner 可以任意，用来抓"owner 写错"） */
const REPO_NAME = 'tdsf-linux-desktop'
const CANONICAL_OWNER = 'harryopo'
const CANONICAL_SLUG = `${CANONICAL_OWNER}/${REPO_NAME}`

/** 形状①：github.com/<owner>/<本仓名> —— owner 不是 harryopo 就是分叉 */
function findWrongOwnerSlugs(text: string): string[] {
  const hits: string[] = []
  const re = /github\.com\/([A-Za-z0-9_.-]+)\/tdsf-linux-desktop/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (m[1] !== CANONICAL_OWNER) hits.push(`${m[1]}/${REPO_NAME}`)
  }
  return hits
}

/** 比较路径一律先归一到 / 分隔：path.relative 在 Windows 给反斜杠，两边不对齐会误判 */
const rel = (f: string): string => path.relative(ROOT, f).replace(/\\/g, '/')

/** 形状②：又抄了一遍全名（单源之外出现即分叉入口） */
function findCopiedSlug(text: string): boolean {
  return text.includes(CANONICAL_SLUG)
}

describe('仓库身份单源 · repo-identity', () => {
  it('量具自证：owner 写错的形状必须被抓到，GitHub 文档站不误伤', () => {
    // 正向：这次的缺陷形状
    const bad = "const R = 'https://github.com/tdsf-linux/tdsf-linux-desktop/releases'"
    expect(findWrongOwnerSlugs(bad)).toEqual(['tdsf-linux/tdsf-linux-desktop'])
    // 不误伤①：GitHub 自己的文档站是 github.com/<两段路径>，不是仓库
    expect(findWrongOwnerSlugs('文档：https://docs.github.com/en/rest/releases/releases')).toEqual([])
    // 不误伤②：模板串里插值的 API URL（没有字面 owner）
    expect(findWrongOwnerSlugs('`https://api.github.com/repos/${slug}/releases/latest`')).toEqual([])
    // 抄一份的形状：单源之外再写全名就该报
    expect(findCopiedSlug("import { X } from 'https://github.com/harryopo/tdsf-linux-desktop'")).toBe(true)
    expect(findCopiedSlug('const REPO = GITHUB_REPO_URL')).toBe(false)
  })

  it('src 下不许有第二个 owner 写法：所有 github.com/<owner>/tdsf-linux-desktop 都是 harryopo', () => {
    const offenders: string[] = []
    for (const f of listSourceFiles(SRC)) {
      for (const slug of findWrongOwnerSlugs(readSourceFile(f))) {
        offenders.push(`${path.relative(ROOT, f)} → ${slug}`)
      }
    }
    expect(offenders, `发现写错的仓库 owner：\n${offenders.join('\n')}`).toEqual([])
  })

  it('仓库全名只许写在单源文件里，别处一律 import（防再抄一份）', () => {
    const copiers: string[] = []
    for (const f of listSourceFiles(SRC)) {
      if (rel(f) === SHARED_MODULE) continue
      if (findCopiedSlug(readSourceFile(f))) copiers.push(rel(f))
    }
    expect(copiers, `这些文件又抄了一遍仓库全名，应改成 import @shared/repo-identity：\n${copiers.join('\n')}`).toEqual([])
  })

  it('URL 一律由 slug 推导，不许出现第二份字面量', () => {
    expect(GITHUB_REPO_SLUG).toBe(CANONICAL_SLUG)
    expect(GITHUB_REPO_URL).toBe(`https://github.com/${GITHUB_REPO_SLUG}`)
    expect(GITHUB_RELEASES_PAGE).toBe(`${GITHUB_REPO_URL}/releases`)
    expect(GITHUB_LATEST_RELEASE_API).toBe(`https://api.github.com/repos/${GITHUB_REPO_SLUG}/releases/latest`)
  })

  it('package.json 的 repository 与单源对账（发布元数据与代码说的是同一个仓）', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as {
      repository?: { url?: string }
    }
    expect(typeof pkg.repository?.url, 'package.json 缺 repository.url').toBe('string')
    const m = /github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/.exec(pkg.repository!.url!)
    expect(m, `repository.url 解析不出 owner/repo：${pkg.repository!.url}`).not.toBeNull()
    expect(`${m![1]}/${m![2]}`).toBe(GITHUB_REPO_SLUG)
  })

  it('检查更新不再自带仓库名：app-update 必须走单源 import', () => {
    const file = path.join(ROOT, 'src', 'main', 'ipc', 'app-update.ts')
    const text = fs.readFileSync(file, 'utf8')
    expect(text).toContain('@shared/repo-identity')
    // 这次的病灶就是这个字面量；留它在文件里＝闸没修上
    expect(text).not.toContain('tdsf-linux/tdsf-linux-desktop')
    // 且 404 要单独成句，不许混进通用失败
    expect(text).toMatch(/404/)
  })
})
