// @vitest-environment jsdom
/**
 * 教程正文的复制与 Markdown 结构（#249）
 *
 * 两条判据：
 *   1. 代码块复制的是围栏内的纯代码，不能把 ``` 或语言标签一起写进剪贴板；
 *   2. writeText 失败时按钮必须显示"复制失败"，不许切成"已复制"。
 * 解析是纯函数，复制走 navigator.clipboard，测试都从真实渲染入口点按钮。
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TutorialMarkdown } from '@renderer/components/tutorial/TutorialMarkdown'
import { parseMarkdownBlocks } from '@renderer/components/tutorial/tutorial-markdown'

vi.mock('sonner', () => {
  const noop = () => undefined
  const toast = Object.assign(noop, {
    success: noop,
    error: noop,
    info: noop,
    warning: noop,
    loading: () => 'id',
    dismiss: noop,
  })
  return { toast }
})

const writeText = vi.fn()

/**
 * user-event 的 setup() 会自己往 navigator.clipboard 装一个桩；
 * 必须等它装完再覆盖，否则测的是 user-event 的桩，不是组件的失败路径。
 */
function installClipboard() {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  })
}

afterEach(() => {
  cleanup()
  Reflect.deleteProperty(navigator, 'clipboard')
})

describe('教程 Markdown 解析', () => {
  it('代码块只保留围栏内的纯代码（不含 ``` 与语言标签）', () => {
    const blocks = parseMarkdownBlocks(
      '先看队列长度：\n\n```bash\ncat /proc/sys/net/core/somaxconn\n# 调整为 1024\nsysctl -w net.core.somaxconn=1024\n```\n',
    )
    expect(blocks).toContainEqual({
      type: 'code',
      lang: 'bash',
      code: 'cat /proc/sys/net/core/somaxconn\n# 调整为 1024\nsysctl -w net.core.somaxconn=1024',
    })
  })

  it('列表、表格、引用、链接都解析成结构化块', () => {
    const blocks = parseMarkdownBlocks(
      '- 第一项\n- 第二项\n\n| 参数 | 值 |\n| --- | --- |\n| somaxconn | 1024 |\n\n> 修改前先在测试环境验证\n\n参考 [内核文档](https://www.kernel.org/doc/)',
    )
    expect(blocks.map((block) => block.type)).toEqual(['list', 'table', 'quote', 'paragraph'])
    expect(blocks.find((block) => block.type === 'table')).toMatchObject({
      header: ['参数', '值'],
      rows: [['somaxconn', '1024']],
    })
  })

  it('结构块渲染成文档元素（列表 / 表格 / 引用 / 链接）', () => {
    const { container } = render(
      <TutorialMarkdown
        content={
          '- 第一项\n- 第二项\n\n| 参数 | 值 |\n| --- | --- |\n| somaxconn | 1024 |\n\n> 注意\n\n参考 [内核文档](https://www.kernel.org/doc/)'
        }
      />,
    )
    expect(container.querySelector('ul.tut-md-list')).toBeTruthy()
    expect(container.querySelector('table.tut-md-table')).toBeTruthy()
    expect(container.querySelector('blockquote.tut-md-blockquote')).toBeTruthy()
    expect(container.querySelector('a.tut-md-link')?.getAttribute('href')).toBe('https://www.kernel.org/doc/')
  })
})

describe('教程复制交互', () => {
  it('点代码块复制按钮，写入剪贴板的是纯代码', async () => {
    writeText.mockReset()
    writeText.mockResolvedValue(undefined)
    const user = userEvent.setup()
    installClipboard()
    render(<TutorialMarkdown content={'```bash\nsystemctl restart nginx\nexit 0\n```'} />)

    await user.click(screen.getByRole('button', { name: '复制代码' }))

    expect(writeText).toHaveBeenCalledWith('systemctl restart nginx\nexit 0')
    expect(await screen.findByText('已复制')).toBeInTheDocument()
  })

  it('复制失败时显示失败，不显示已复制', async () => {
    writeText.mockReset()
    writeText.mockRejectedValue(new Error('剪贴板被拒绝'))
    const user = userEvent.setup()
    installClipboard()
    render(<TutorialMarkdown content={'```bash\necho hi\n```'} />)

    await user.click(screen.getByRole('button', { name: '复制代码' }))

    expect(await screen.findByText('复制失败')).toBeInTheDocument()
    expect(screen.queryByText('已复制')).toBeNull()
    expect(screen.getByRole('button', { name: /复制失败/ })).toBeInTheDocument()
  })
})
