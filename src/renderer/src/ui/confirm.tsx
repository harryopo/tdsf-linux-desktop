/**
 * 命令式确认框：confirmDialog(opts) → Promise<boolean>
 *
 * 替代 antd 的 Modal.confirm。antd 那个静态方法要靠
 * @ant-design/v5-patch-for-react-19 才能工作（React 19 删了 ReactDOM.render），
 * 这是仓库里最后一个"必须打补丁才能跑"的依赖点，换成 radix + 自挂的 ConfirmHost 就能拔掉。
 *
 * 默认焦点落在"取消"上，与底部审批条同一个取向：确认要主动一步，回车不应直接执行破坏性操作。
 */
import { useEffect, useState, type ReactNode } from 'react'
import { Button } from './button'
import { Dialog, DialogContent } from './overlay'

export interface ConfirmOptions {
  title: string
  description?: ReactNode
  okText?: string
  cancelText?: string
  /** 破坏性操作：确认按钮走危险色，且焦点默认停在取消 */
  danger?: boolean
}

interface Pending {
  opts: ConfirmOptions
  resolve: (ok: boolean) => void
}

let pending: Pending | null = null
const subscribers = new Set<() => void>()

function emit() {
  for (const fn of subscribers) fn()
}

/** 打开确认框；Esc / 点遮罩 / 取消都算 false。连开两个时前一个按 false 收掉。 */
export function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
  pending?.resolve(false)
  return new Promise<boolean>((resolve) => {
    pending = { opts, resolve }
    emit()
  })
}

function settle(ok: boolean) {
  const current = pending
  pending = null
  current?.resolve(ok)
  emit()
}

/** 挂在 App 里的唯一宿主（与 Toaster 同级） */
export function ConfirmHost() {
  const [state, setState] = useState<Pending | null>(pending)

  useEffect(() => {
    const fn = () => setState(pending)
    subscribers.add(fn)
    fn()
    return () => {
      subscribers.delete(fn)
    }
  }, [])

  const opts = state?.opts

  return (
    <Dialog open={Boolean(state)} onOpenChange={(open) => !open && settle(false)}>
      {opts ? (
        <DialogContent
          title={opts.title}
          description={opts.description}
          className="w-[min(440px,92vw)]"
          footer={
            <>
              <Button
                variant="outline"
                size="md"
                autoFocus={opts.danger}
                onClick={() => settle(false)}
              >
                {opts.cancelText ?? '取消'}
              </Button>
              <Button
                variant={opts.danger ? 'danger' : 'solid'}
                size="md"
                autoFocus={!opts.danger}
                onClick={() => settle(true)}
              >
                {opts.okText ?? '确定'}
              </Button>
            </>
          }
        />
      ) : null}
    </Dialog>
  )
}
