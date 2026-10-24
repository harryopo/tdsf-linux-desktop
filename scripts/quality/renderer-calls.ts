/**
 * 渲染层"这一份源码用到了哪些 electronAPI 成员"的识别器（纯函数）
 *
 * 为什么单独成文件：`audit:ipc` 的第四项（哪些 preload 键渲染层零调用）就是债的读数，
 * 而它过去只会认两种写法——
 *   1. `window.electronAPI.foo()`
 *   2. `const api = window.electronAPI` 之后的 `api.foo()`
 * 第三种在写的接线被漏掉：`const { foo } = window.electronAPI` 再调 `foo()`。
 * 2026-10-24 实测：`src/renderer/src/stores/settings-store.ts` 就是这种写法，
 * 于是 configSaveLlm / storageHasApiKey / storageSaveApiKey 三条**在用**的键
 * 被报成零调用。按那份清单去删就会砍掉活接线——量具假红把债指到了不该砍的地方。
 *
 * 判"用过了"的口径：解构出来的那个局部名，必须在同一份源码里**真的以调用形式出现**
 * （`foo(` / `foo?.(`）。光解构不调用仍然算零调用，否则"拿进来没用"这种白做会被自己洗白。
 */

const MEMBER_RE = /(?:window\.)?electronAPI[?!]?\.(\w+)/g
const API_ALIAS_DECL_RE = /const\s+api\s*=\s*(?:window\.)?electronAPI\b/
const API_ALIAS_CALL_RE = /\bapi[?!]?\.(\w+)\s*\(/g
const DESTRUCTURE_RE = /(?:const|let|var)\s*\{([^}]*)\}\s*=\s*(?:window\.)?electronAPI\b/g

/** 这份源码里被用到的 electronAPI 成员名（属性名，不是本地别名） */
export function rendererMembersUsed(text: string): Set<string> {
  const used = new Set<string>()

  for (const m of text.matchAll(MEMBER_RE)) used.add(m[1])

  if (API_ALIAS_DECL_RE.test(text)) {
    for (const m of text.matchAll(API_ALIAS_CALL_RE)) used.add(m[1])
  }

  for (const m of text.matchAll(DESTRUCTURE_RE)) {
    for (const item of m[1].split(',')) {
      // `prop` / `prop: local` / `prop = 默认值` / `prop: local = 默认值`
      const withoutDefault = item.split('=')[0].trim()
      if (!withoutDefault) continue
      const [propRaw, localRaw] = withoutDefault.split(':').map((s) => s.trim())
      if (!propRaw || !/^\w+$/.test(propRaw)) continue
      const local = localRaw && /^\w+$/.test(localRaw) ? localRaw : propRaw
      // 局部名必须被当成函数调起来，才算这条通道真的有人用
      const callRe = new RegExp(`\\b${local}\\s*(?:\\?\\.)?\\s*\\(`)
      if (callRe.test(text)) used.add(propRaw)
    }
  }

  return used
}
