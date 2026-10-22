/**
 * 仓库身份单源（owner/repo）
 *
 * 为什么要单源：2026-10-22 实测，全仓六处写着这个仓库，五处是 `harryopo/...`
 * （about 页、scripts/release.ps1、README、SECURITY），只有 `src/main/ipc/app-update.ts`
 * 自己写了一份 `tdsf-linux/...`。那个副本是"检查更新"唯一的数据来源，
 * 于是界面上那个按钮每次点都 404——不是网络问题，是它去问了一个不存在的仓库。
 *
 * 判据在 `tests/unit/repo-identity.test.ts`：扫 src 下所有 github.com/<owner>/<repo> 字样，
 * 与本名不同的直接红。这条闸存在的意义就是"以后再抄一份就当场抓住"。
 *
 * package.json 的 repository 字段与本文件同源，由同一条测试对账。
 */

/** GitHub 上的仓库标识，格式 owner/repo */
export const GITHUB_REPO_SLUG = 'harryopo/tdsf-linux-desktop' as const

/** 仓库主页 */
export const GITHUB_REPO_URL = `https://github.com/${GITHUB_REPO_SLUG}` as const

/** Releases 列表页（"前往下载"落点） */
export const GITHUB_RELEASES_PAGE = `${GITHUB_REPO_URL}/releases` as const

/**
 * GitHub Releases API 的 latest 端点。
 *
 * 注意口径：`releases/latest` 只认【已发布】的 Release，草稿不算——所以仓库只有一个
 * 草稿时会返回 404。这条 URL 的消费方必须能把"404 = 还没有已发布版本"和
 * "网络/权限失败"分开说，不许都写成"检查失败"。
 */
export const GITHUB_LATEST_RELEASE_API = `https://api.github.com/repos/${GITHUB_REPO_SLUG}/releases/latest` as const
