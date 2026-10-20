import { Alert, Button, Flex, Popover, Select, Space, Tag, Tooltip, Typography } from 'antd'
import { ReloadOutlined, SettingOutlined } from '@ant-design/icons'
import type { ReactNode } from 'react'
import { useClusterStore } from '../store/useClusterStore'

interface Props {
  title: string
  description?: string
  /** 头部图标砖，缺省则不显示 */
  icon?: ReactNode
  onRefresh?: () => void
  loading?: boolean
  /** 是否显示命名空间选择器 */
  namespaced?: boolean
  /** 工具条右侧的自定义操作（如「创建」按钮） */
  actions?: ReactNode
  /** 工具条左侧：一般是搜索框 */
  search?: ReactNode
  /** 是否显示列设置齿轮（KubeSphere 列表右上角） */
  showColumns?: boolean
  error?: string
  /** 头部与列表之间的统计条内容（StatStrip） */
  stats?: ReactNode
  /** 内容贴边（表格类页面用，对应 KubeSphere 的列表卡） */
  flush?: boolean
  children: ReactNode
}

export function PageShell({
  title,
  description,
  icon,
  onRefresh,
  loading,
  namespaced = true,
  actions,
  search,
  showColumns = false,
  error,
  stats,
  flush = false,
  children,
}: Props) {
  const { namespace, namespaces, setNamespace } = useClusterStore()

  const hasToolbar = !!(search || actions || onRefresh || showColumns)

  return (
    <div>
      {error && (
        <Alert
          className="mb-3"
          type="error"
          showIcon
          closable
          message={
            <Space>
              <Tag color="red" variant="filled">
                接口错误
              </Tag>
              {error}
            </Space>
          }
        />
      )}

      <div className="ks-card !overflow-hidden">
        {/* 页面标题区：图标砖 + 标题 + 描述（KubeSphere 式描述条） */}
        <div className="flex items-center gap-3 px-5 py-4">
          {icon && (
            <span className="grid size-11 shrink-0 place-items-center rounded bg-[#f4f6fa] text-xl text-[#5c6b80]">
              {icon}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <Typography.Title level={5} style={{ margin: 0, fontWeight: 700, color: '#15233a' }}>
              {title}
            </Typography.Title>
            {description && (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {description}
              </Typography.Text>
            )}
          </div>
          {namespaced && (
            <Select
              size="small"
              style={{ width: 160 }}
              value={namespace}
              onChange={setNamespace}
              placeholder="命名空间"
              variant="borderless"
              suffixIcon={null}
              className="rounded bg-[#f4f6fa] px-1"
              options={namespaces.map((n) => ({ label: n.name, value: n.name }))}
            />
          )}
        </div>

        {stats && <div className="border-t border-[#ebeef2] px-5 py-4">{stats}</div>}

        {/* 工具条：左=搜索，右=操作 + 刷新 + 列设置 */}
        {hasToolbar && (
          <Flex justify="space-between" align="center" gap={12} className="ks-toolbar">
            <div className="min-w-0 flex-1">{search}</div>
            <Space size={4}>
              {actions}
              {onRefresh && (
                <Tooltip title="刷新">
                  <Button type="text" icon={<ReloadOutlined />} loading={loading} onClick={onRefresh} />
                </Tooltip>
              )}
              {showColumns && (
                <Popover
                  trigger="click"
                  placement="bottomRight"
                  content={<Typography.Text type="secondary" style={{ fontSize: 12 }}>列设置</Typography.Text>}
                >
                  <Tooltip title="列设置">
                    <Button type="text" icon={<SettingOutlined />} />
                  </Tooltip>
                </Popover>
              )}
            </Space>
          </Flex>
        )}

        <div className={flush ? '' : 'px-5 pb-5 pt-1'}>{children}</div>
      </div>
    </div>
  )
}

const TONES: Record<string, string> = {
  Running: '#59c492',
  Ready: '#59c492',
  Active: '#59c492',
  Bound: '#59c492',
  Complete: '#59c492',
  Completed: '#59c492',
  Available: '#59c492',
  Succeeded: '#59c492',
  Healthy: '#59c492',
  Pending: '#f5a623',
  NotReady: '#f5a623',
  Updating: '#f5a623',
  Terminating: '#f5a623',
  Unknown: '#9aa7b8',
  Failed: '#d94f4f',
  CrashLoopBackOff: '#d94f4f',
  Error: '#d94f4f',
  Unbound: '#d94f4f',
  SchedulingDisabled: '#f5a623',
}

export function StatusTag({ phase }: { phase?: string }) {
  const color =
    phase === 'Running' || phase === 'Ready' || phase === 'Active' || phase === 'Bound'
      ? 'green'
      : phase === 'Pending' || phase === 'NotReady' || phase === 'Unknown'
        ? 'orange'
        : phase === 'Failed' || phase === 'CrashLoopBackOff' || phase === 'Error' || phase === 'Terminating'
          ? 'red'
          : 'default'
  return (
    <Tag color={color} variant="filled">
      {phase ?? '-'}
    </Tag>
  )
}

/** KubeSphere 式状态：彩点 + 深色文案，可带尾随补充信息 */
export function StatusDot({ phase, extra }: { phase?: string; extra?: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap">
      <span className="size-[7px] shrink-0 rounded-full" style={{ background: TONES[phase ?? ''] ?? '#9aa7b8' }} />
      <span style={{ fontWeight: 500, color: '#15233a' }}>{phase ?? '-'}</span>
      {extra && <span className="text-[#8f9aa9]">{extra}</span>}
    </span>
  )
}

/** 图标砖 + 名称 + 次要信息（IP / 命名空间 / 版本）——KubeSphere 列表名称列 */
export function NameCell({ icon, title, sub }: { icon?: ReactNode; title?: string; sub?: string }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      {icon && (
        <span className="grid size-8 shrink-0 place-items-center rounded-md bg-[#f4f6fa] text-base text-[#5c6b80]">
          {icon}
        </span>
      )}
      <div className="min-w-0">
        <div className="truncate font-medium" style={{ color: '#15233a' }} title={title}>
          {title ?? '-'}
        </div>
        {sub && <div className="kbd-mono truncate text-xs text-[#8f9aa9]">{sub}</div>}
      </div>
    </div>
  )
}

/** 主值加粗 + 下方灰色补充值，用于用量类单元格 */
export function MetricCell({ value, sub }: { value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="font-semibold" style={{ color: '#15233a' }}>{value}</div>
      {sub && <div className="truncate text-xs text-[#8f9aa9]">{sub}</div>}
    </div>
  )
}

/** 头部与列表之间的计数条，如「3 节点 / 1 控制平面 / 2 工作节点」；由 PageShell 的 stats 插槽承载 */
export function StatStrip({ items }: { items: { icon?: ReactNode; value: ReactNode; label: string }[] }) {
  return (
    <div className="flex flex-wrap gap-x-14 gap-y-4">
      {items.map((it) => (
        <div key={it.label} className="flex items-center gap-2.5">
          {it.icon && <span className="text-lg text-[#8f9aa9]">{it.icon}</span>}
          <div>
            <div className="text-xl font-semibold leading-none" style={{ color: '#15233a' }}>{it.value}</div>
            <div className="mt-1 text-xs text-[#8f9aa9]">{it.label}</div>
          </div>
        </div>
      ))}
    </div>
  )
}
