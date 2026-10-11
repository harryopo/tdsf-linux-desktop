/**
 * Monaco 本地化 —— 打包后编辑器不白屏的前提
 *
 * `@monaco-editor/react` 默认在运行时去 CDN 拉 AMD loader：实测
 * `@monaco-editor/loader@1.7.0` 的默认地址是
 * `https://cdn.jsdelivr.net/npm/monaco-editor@0.55.1/min/vs`，而我们的 CSP 是
 * `script-src 'self'`（src/main/windows/main-window.ts:39），打包后这条脚本必被拒绝，
 * 编辑区整块空白。开发态 CSP 不注入，所以四绿与全部 e2e 都照不到它（和 P1-1、P1-6 同一类）。
 * 顺带修掉另一处错位的真相：CDN 里钉的是 0.55.1，项目直接依赖是 monaco-editor@0.56.0。
 *
 * 为什么不用 `import * as monaco from 'monaco-editor'`：0.56 的 ESM 总入口
 * （esm/vs/index.js）第一行就 import '../external/monaco-lsp-client/out/index.js'，
 * 那个目录没随包发布，Rollup 直接解析失败。editor.api 是同一套 API，但不带 LSP 客户端。
 *
 * 语言只注册界面真会出现的那几种（对应 MonacoEditorLanguage），每个 register 里的
 * tokenizer 是 lazy import，不进主 chunk。json 例外：0.56 把 json 从 basic-languages
 * 挪进了 features/json，而它的专用 worker 在 Vite 的 ?worker 通道里解析不出来，
 * 所以 json 文件目前按纯文本渲染（见任务 #79）。
 *
 * worker 用 `?worker&inline`：Vite 把 worker 编成 base64 内联、运行时以 blob: 起。
 * 必须内联而不是产出独立文件——应用以 file:// 加载，Chromium 不允许从 file: 直接
 * new Worker，而 CSP 的 worker-src 已经放行 blob:。
 */
import * as monaco from 'monaco-editor/editor/editor.api'
import { loader } from '@monaco-editor/react'
import EditorWorker from 'monaco-editor/editor/editor.worker?worker&inline'
import 'monaco-editor/languages/definitions/shell/register'
import 'monaco-editor/languages/definitions/python/register'
import 'monaco-editor/languages/definitions/yaml/register'
import 'monaco-editor/languages/definitions/markdown/register'
import 'monaco-editor/languages/definitions/ini/register'

self.MonacoEnvironment = {
  getWorker() {
    return new EditorWorker()
  },
}

loader.config({ monaco })
