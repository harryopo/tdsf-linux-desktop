// @vitest-environment jsdom
/**
 * 「清除已保存的 Key」入口（2026-10-21 发布前收口）
 *
 * 主进程一直有 storage:deleteApiKey，但界面没有入口，于是"Key 存在本机"这件事
 * 只能写不能撤。这里钉住两半：存过 Key 才出现入口；按下去真的调用删除回调。
 * （删除本身的行为在 tests/unit/settings-save-envelope.test.ts 里验。）
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ApiTestSection } from '@renderer/components/settings/model/ApiTestSection'

const BASE_PROPS = {
  endpoint: 'https://api.example.invalid/v1',
  onEndpointChange: () => {},
  apiKey: '',
  onApiKeyChange: () => {},
  showApiKey: false,
  onToggleShowApiKey: () => {},
  onTestConnection: () => {},
  isTesting: false,
  lastTestTime: '',
  testResult: 'idle' as const,
  testLatency: null,
  testLogs: [],
  selectedModel: 'x',
}

describe('ApiTestSection 清除已保存的 Key', () => {
  it('存过 Key 时显示入口，点击调用删除回调', () => {
    const onDeleteSavedKey = vi.fn()
    render(
      <ApiTestSection
        {...BASE_PROPS}
        hasSavedKey
        onDeleteSavedKey={onDeleteSavedKey}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '清除已保存的 Key' }))
    expect(onDeleteSavedKey).toHaveBeenCalledTimes(1)
  })

  it('没存过 Key 时不摆一个删不掉的按钮', () => {
    render(
      <ApiTestSection
        {...BASE_PROPS}
        hasSavedKey={false}
        onDeleteSavedKey={() => {}}
      />
    )

    expect(screen.queryByRole('button', { name: '清除已保存的 Key' })).toBeNull()
  })
})
