/**
 * 外部 MCP 探针服务器（e2e 夹具，stdio）
 *
 * 只报一件事：这个子进程**看得见哪些环境变量名**（不回报任何值）。
 * 用它判 #173 关掉的洞——以前外部 stdio 子进程拿到的是整个 process.env，
 * 现在只该拿到"SDK 认为可安全继承的那批 + 用户在设置页点名的键"。
 * 夹具自己不带断言，断言在 tests/e2e/mcp-external-settings.spec.ts。
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'

const PROBE_VAR = 'TDSF_E2E_MCP_PROBE'

const server = new Server(
  { name: 'tdsf-env-probe', version: '1.0.0' },
  { capabilities: { tools: {} } }
)

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'env_probe',
      description: '回报这个子进程看见的环境变量名（只有名字，没有值）',
      inputSchema: { type: 'object', properties: {} },
    },
  ],
}))

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name !== 'env_probe') {
    return { content: [{ type: 'text', text: `未知工具：${request.params.name}` }], isError: true }
  }
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          envNames: Object.keys(process.env).sort(),
          seenProbeVar: process.env[PROBE_VAR] !== undefined,
        }),
      },
    ],
  }
})

await server.connect(new StdioServerTransport())
