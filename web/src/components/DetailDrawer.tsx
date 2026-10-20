import { Drawer } from 'antd'
import type { ReactNode } from 'react'

/**
 * 详情抽屉：所有资源详情的统一外壳（右侧滑出，正文即原整页详情内容）。
 * body padding 归零，让正文里的贴边卡片/页签直接铺满抽屉宽度。
 */
export function DetailDrawer({
  open,
  title,
  actions,
  onClose,
  children,
}: {
  open: boolean
  title: ReactNode
  actions?: ReactNode
  onClose: () => void
  children: ReactNode
}) {
  return (
    <Drawer
      open={open}
      onClose={onClose}
      placement="right"
      size={960}
      destroyOnHidden
      title={title}
      extra={actions && <div className="flex items-center gap-2">{actions}</div>}
      styles={{ body: { padding: 0 } }}
    >
      {children}
    </Drawer>
  )
}
