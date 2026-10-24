/**
 * 渲染层"这一份源码用到了哪些 electronAPI 成员"的识别器（纯函数）
 *
 * 为什么单独成文件：`audit:ipc` 的第四项（哪些 preload 键渲染层零调用）就是债的读数。
 * 它原先只认 `window.electronAPI.foo()` 一种写法。2026-10-24 一天内抓到四类**在用**
 * 却被漏判的接线：
 *   1. `const { foo } = window.electronAPI` 再调 `foo()`
 *      —— stores/settings-store.ts:174 的 configSaveLlm / storageHasApiKey / storageSaveApiKey
 *   2. 别名之后的可选调用 `api.foo?.()`
 *      —— components/terminal/TerminalView.tsx 的 localTtyWrite / localTtyResize
 *   3. 把方法当引用取走、在别处调
 *      —— terminal/shell-launcher.ts 的 `const call = kind === 'local' ? api?.localTtyClose : api?.sshShellClose`
 *   4. 别名来自访问器函数 `const api = getElectronAPI()`
 *      —— stores/db-status-store.ts:39 的 dbGetStatus（第四类由 #201 那一轮自查抓出）
 * 照着漏判的清单去删，砍的是活线（#60 那批假 FAIL 是同一族错）。
 *
 * 口径由 tests/unit/renderer-calls-instrument.test.ts 从两个方向钉住：
 * 漏判要红；把"解构了没用"洗成在用，也要红。
 * 特别地，`const off = window.electronAPI.onX(cb)` 里的 `off` 是退订函数，
 * **不是** electronAPI 的别名——把它当别名，`off.anything` 就会冒充接线。
 */

/**
 * electronAPI 直接成员访问：`electronAPI.foo` / `window.electronAPI?.foo`。
 * 允许 `.` 前后有空白与换行——链式调用就是会换行，
 * RiskSettings.tsx 写作 `window.electronAPI` 换行 `.riskGetRules()`，
 * 早先不容忍换行时这条在用的键被报成零调用。
 */
const DIRECT_MEMBER_RE = /(?:window\.)?electronAPI\s*[?!]?\s*\.\s*(\w+)/g

/**
 * 别名声明：`const <id> = window.electronAPI`，且等号右边到此为止。
 * 后面还跟着 `.` 的（`electronAPI.onX(...)`）声明的是返回值，不是别名。
 */
const ALIAS_DECL_RE = /(?:const|let|var)\s+(\w+)\s*=\s*(?:window\.)?electronAPI(?![.\w])/g

/**
 * 别名声明走访问器函数：`const <id> = getElectronAPI()`。
 * 第四种漏判（2026-10-24，db-status-store.ts:39）：那份文件不直接碰 window.electronAPI，
 * 而是调 utils/electron-api.ts 里的 `getElectronAPI(): Window['electronAPI'] | undefined`。
 * 只认" callee 是一个标识符、名字里带 electronAPI、且不带实参"——
 * 带点的成员表达式（`window.electronAPI.onX(cb)`）与无关工厂（`createClient()`）都不算，
 * 否则任何对象都能把自己的方法冒充成接线。
 */
const ACCESSOR_ALIAS_RE =
  /(?:const|let|var)\s+(\w+)\s*=\s*([A-Za-z_$][\w$]*[Ee]lectron[Aa][Pp][Ii][\w$]*)\s*\(\s*\)/g

/** 解构：`const { a, b: local } = window.electronAPI` */
const DESTRUCTURE_RE = /(?:const|let|var)\s*\{([^}]*)\}\s*=\s*(?:window\.)?electronAPI(?![.\w])/g

const IDENT = /^[A-Za-z_$][\w$]*$/

/** 这份源码里被用到的 electronAPI 成员名（属性名，不是本地别名） */
export function rendererMembersUsed(text: string): Set<string> {
  const used = new Set<string>()

  for (const m of text.matchAll(DIRECT_MEMBER_RE)) used.add(m[1])

  // 别名：`api.foo` / `api?.foo` 都算碰到了那个成员。
  // 内联调用、可选调用、还是取走当引用回头再调，运行时都是同一条线。
  const aliases = new Set<string>()
  for (const m of text.matchAll(ALIAS_DECL_RE)) aliases.add(m[1])
  for (const m of text.matchAll(ACCESSOR_ALIAS_RE)) aliases.add(m[1])
  for (const alias of aliases) {
    if (!IDENT.test(alias)) continue
    const accessRe = new RegExp('\\b' + alias + '\\s*(?:\\?\\.|\\.)\\s*(\\w+)', 'g')
    for (const hit of text.matchAll(accessRe)) used.add(hit[1])
  }

  // 解构：属性绑到的那个局部名必须**真的被调起来**（`foo(...)` 或 `foo?.(...)`）。
  // 只解构不用仍然是白做，不许洗白。
  for (const m of text.matchAll(DESTRUCTURE_RE)) {
    for (const item of m[1].split(',')) {
      // `prop` / `prop: local` / `prop = 默认值` / `prop: local = 默认值`
      const withoutDefault = item.split('=')[0].trim()
      if (!withoutDefault) continue
      const [propRaw, localRaw] = withoutDefault.split(':').map((s) => s.trim())
      if (!propRaw || !/^\w+$/.test(propRaw)) continue
      const local = localRaw && /^\w+$/.test(localRaw) ? localRaw : propRaw
      const callRe = new RegExp('\\b' + local + '\\s*(?:\\?\\.)?\\s*\\(')
      if (callRe.test(text)) used.add(propRaw)
    }
  }

  return used
}
