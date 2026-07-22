import type { FC } from 'react'

/** 迷你进度条 */
const MiniBar: FC<{ percent: number; color?: string }> = ({ percent, color = 'var(--trae-bg-brand)' }) => (
  <div className="mini-bar-track">
    <div className="mini-bar-fill" style={{ width: `${percent}%`, background: color }} />
  </div>
)

export default MiniBar
