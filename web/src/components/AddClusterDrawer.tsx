import { Alert, Drawer, Input, Typography } from 'antd'
import { useEffect, useState } from 'react'
import { agentApi } from '../api/cluster'
import { useClusterStore } from '../store/useClusterStore'

/**
 * 添加集群（集群接入）右侧抽屉。
 *
 * 只保留真正的接入流程：填集群名（唯一必填）→ 直接展示安装 Agent 的 kubectl 命令。
 * 命令为 `kubectl apply -f "<服务端地址+guid>"`，用户复制整条命令到目标集群执行即可。
 */
export function AddClusterDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const cluster = useClusterStore((s) => s.cluster)
  const [installName, setInstallName] = useState('')
  // 每次打开抽屉生成一个接入 guid（destroyOnHidden 使组件每次打开都重挂载，天然刷新）
  const [guid] = useState(() => crypto.randomUUID())

  // 每次打开默认预填当前集群名（未选则留空）
  useEffect(() => {
    if (!open) return
    setInstallName((prev) => prev || cluster)
  }, [open, cluster])

  // 绝对地址：控制台可能跑在 NodePort IP 或 Ingress 域名上，不能写死
  const installUrl = `${window.location.origin}${agentApi.installUrl(installName, guid)}`
  const installCommand = `kubectl apply -f "${installUrl}"`

  return (
    <Drawer open={open} onClose={onClose} placement="right" size={520} title="集群接入" destroyOnHidden>
      <div className="mb-2 text-[13px]" style={{ color: 'var(--ks-body)' }}>
        集群名称
      </div>
      <Input
        placeholder="集群名（必填）"
        value={installName}
        onChange={(e) => setInstallName(e.target.value)}
        status={installName ? undefined : 'warning'}
      />

      {installName ? (
        <div className="mt-4">
          <div className="mb-2 text-[13px]" style={{ color: 'var(--ks-body)' }}>
            安装 Agent
          </div>
          <Typography.Paragraph
            code
            copyable={{ text: installCommand }}
            className="ks-cmd !mb-0"
          >
            {installCommand}
          </Typography.Paragraph>
        </div>
      ) : (
        <Alert
          className="mt-4"
          type="info"
          showIcon
          message="填写集群名称后，这里会出现一条可直接复制执行的 kubectl 安装命令。"
        />
      )}
    </Drawer>
  )
}
