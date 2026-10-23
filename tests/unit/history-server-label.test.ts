/**
 * 决策历史"服务器"列的读数口径（任务 #175-①）
 *
 * 这一列原先显示 `会话 xxxx` / `'local'`，下拉选项却来自另一份数据（真 serverId），
 * 选了必空。判据钉的是"三种情况给出三种不同说法"与"选项一定来自当前页能筛到的行"。
 */
import { describe, it, expect } from 'vitest'
import { ALL_SERVERS, NO_SERVER, serverLabel, serverOptions } from '@renderer/lib/history-server'

const servers = [
  { id: 'srv-0001-aaaa', name: '实验楼服务器' },
  { id: 'srv-0002-bbbb', name: '家里笔记本' },
]

describe('决策历史的服务器读数', () => {
  it('记了 serverId 且服务器还在列表里：显示用户起的名字', () => {
    expect(serverLabel('srv-0001-aaaa', servers)).toBe('实验楼服务器')
  })

  it('没记 serverId：说"未记录"，不许编一个主机名', () => {
    expect(serverLabel(null, servers)).toBe(NO_SERVER)
    expect(serverLabel(undefined, servers)).toBe(NO_SERVER)
    expect(serverLabel('', servers)).toBe(NO_SERVER)
  })

  it('有 id 但认不出来（删过服务器或列表没加载完）：显示 id 前缀，不冒充"未记录"', () => {
    const label = serverLabel('srv-dead-9999-x', servers)
    expect(label).not.toBe(NO_SERVER)
    expect(label.startsWith('服务器 ')).toBe(true)
    // id 不外泄全文，只给前 8 位
    expect(label).toBe('服务器 srv-dead')
    expect(label).not.toContain('9999')
  })

  it('选项由当前页那些行的标签派生，去重且第一项是"全部"', () => {
    const labels = [
      serverLabel('srv-0001-aaaa', servers),
      serverLabel('srv-0001-aaaa', servers),
      serverLabel(null, servers),
    ]
    expect(serverOptions(labels)).toEqual([ALL_SERVERS, '实验楼服务器', NO_SERVER])
  })

  it('空页也只剩"全部"一项，不会给出一个筛不出东西的选项', () => {
    expect(serverOptions([])).toEqual([ALL_SERVERS])
  })
})
