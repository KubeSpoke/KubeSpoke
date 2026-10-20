import { App, Button, Descriptions, Empty, Form, Input, Modal, Spin } from 'antd'
import { ClusterOutlined, EditOutlined, ReloadOutlined } from '@ant-design/icons'
import { useState } from 'react'
import type { ReactNode } from 'react'
import { clusterApi } from '../../api/cluster'
import { resourceApi, toItems } from '../../api/resources'
import type { ResourceDescriptor } from '../../config/nav'
import { useResource } from '../../hooks/useResource'
import { useClusterStore } from '../../store/useClusterStore'
import { toYaml } from '../../utils/yaml'

/**
 * 集群级元数据约定（与「集群可见性」页、概览页共用）：
 * 直接落在 kube-system 命名空间的注解上，读改写均走通用资源接口。
 */
const ANNO_ALIAS = 'kubespoke.io/alias-name'
const ANNO_DESCRIPTION = 'kubespoke.io/description'
const CLUSTER_META_NAMESPACE = 'kube-system'

/** namespace inline descriptor：Cluster 作用域，read 时不需要 Namespace 参数 */
const NAMESPACES: ResourceDescriptor = {
  key: 'namespaces',
  label: '命名空间',
  kind: 'Namespace',
  group: '',
  version: 'v1',
  plural: 'namespaces',
  scope: 'Cluster',
  statusKind: 'none',
}

const NODES: ResourceDescriptor = {
  key: 'nodes',
  label: '节点',
  kind: 'Node',
  group: '',
  version: 'v1',
  plural: 'nodes',
  scope: 'Cluster',
  statusKind: 'conditions',
}

/** 视觉 token：与节点管理页同一套语言 */
const BANNER_BG = 'linear-gradient(90deg, #f2f7ff 0%, #e9f1fd 60%, #eef4fe 100%)'
const ICON_BRICK = 'linear-gradient(135deg, #5ea0ff, #1668dc)'
const PRIMARY_BTN = { background: 'linear-gradient(90deg, #3f8cff, #1f5fe0)', borderColor: '#1f5fe0' }

/** 白色圆角卡片分区：标题 + 可选说明 + 右侧操作 + 内容（对齐节点管理页 Panel） */
function Panel({ title, description, extra, children }: { title: string; description?: string; extra?: ReactNode; children: ReactNode }) {
  return (
    <div className="rounded-lg bg-white" style={{ border: '1px solid #e6ebf1' }}>
      <div className="flex items-center justify-between gap-3 px-4" style={{ minHeight: 48, borderBottom: '1px solid #eef1f5' }}>
        <div className="min-w-0">
          <span style={{ fontSize: 14, fontWeight: 600, color: '#15233a' }}>{title}</span>
          {description && (
            <span className="ml-2 text-xs" style={{ color: '#8f9aa9' }}>
              {description}
            </span>
          )}
        </div>
        {extra && <div className="shrink-0">{extra}</div>}
      </div>
      <div className="px-4 py-3">{children}</div>
    </div>
  )
}

/**
 * 集群元数据载体 = kube-system 原对象整体转 YAML 提交（列表页「编辑 YAML」同一惯例）。
 * 值为 null 表示删除该注解；服务端 ApplyYaml 对 Namespace 走 Replace，resourceVersion 随原对象带回。
 */
async function patchClusterAnnotations(
  cluster: string,
  patch: Record<string, string | null>,
): Promise<void> {
  const obj = await resourceApi.read(cluster, NAMESPACES, CLUSTER_META_NAMESPACE)
  if (obj.kind !== 'Namespace' || obj.metadata?.name !== CLUSTER_META_NAMESPACE) {
    throw new Error(`未能读取 ${CLUSTER_META_NAMESPACE} 命名空间对象`)
  }
  const annotations = { ...(obj.metadata?.annotations ?? {}) }
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === '') delete annotations[key]
    else annotations[key] = value
  }
  obj.metadata = { ...obj.metadata, annotations }
  await resourceApi.applyYaml(cluster, toYaml(obj))
}

/** 通用接口拿不到 core 组列表时（服务端回落到 CustomObjects）用类型化接口兜底 */
async function kubeVersionOf(cluster: string): Promise<string> {
  try {
    const first = toItems(await resourceApi.list(cluster, NODES))[0]
    const version = (first?.status as { nodeInfo?: { kubeletVersion?: string } } | undefined)?.nodeInfo?.kubeletVersion
    if (version) return version
  } catch {
    // 忽略，继续走类型化接口
  }
  const nodes = await clusterApi.nodes(cluster).catch(() => undefined)
  return nodes?.[0]?.status?.nodeInfo?.kubeletVersion ?? '-'
}

interface BaseInfo {
  alias: string
  description: string
  version: string
}

/** 集群基本信息整页正文：独立路由与集群管理页的详情抽屉共用（编辑就地完成） */
export function ClusterBaseInfo({ cluster, onChanged }: { cluster: string; onChanged?: () => void }) {
  const { message } = App.useApp()
  const [form] = Form.useForm<{ alias: string; description: string }>()
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)

  const { data, error, loading, refresh } = useResource<BaseInfo>(
    async () => {
      if (!cluster) return { alias: '', description: '', version: '-' }
      const [meta, version] = await Promise.all([
        resourceApi.read(cluster, NAMESPACES, CLUSTER_META_NAMESPACE).catch(() => undefined),
        kubeVersionOf(cluster),
      ])
      const ann = meta?.metadata?.annotations ?? {}
      return { alias: ann[ANNO_ALIAS] ?? '', description: ann[ANNO_DESCRIPTION] ?? '', version }
    },
    [cluster],
  )

  if (!cluster) return <Empty description="请先选择一个在线集群" className="py-24" />

  const openEdit = () => {
    form.setFieldsValue({ alias: data?.alias ?? '', description: data?.description ?? '' })
    setOpen(true)
  }

  const doSave = async () => {
    let values: { alias?: string; description?: string }
    try {
      values = await form.validateFields()
    } catch {
      return
    }
    setSaving(true)
    try {
      await patchClusterAnnotations(cluster, {
        [ANNO_ALIAS]: values.alias?.trim() ?? '',
        [ANNO_DESCRIPTION]: values.description?.trim() ?? '',
      })
      message.success('已更新集群信息')
      setOpen(false)
      refresh()
      onChanged?.()
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error} <Button size="small" onClick={refresh}>重试</Button>
        </div>
      )}

      <Panel
        title="集群信息"
        extra={
          <Button size="small" type="primary" icon={<EditOutlined />} style={PRIMARY_BTN} onClick={openEdit}>
            编辑信息
          </Button>
        }
      >
        <Spin spinning={loading && !data}>
          <Descriptions
            size="small"
            column={{ xs: 1, sm: 2, xl: 3 }}
            items={[
              {
                key: 'name',
                label: '名称',
                children: (
                  <div className="min-w-0">
                    <div className="truncate font-semibold" style={{ color: '#15233a' }} title={cluster}>
                      {cluster}
                    </div>
                    <div className="kbd-mono truncate text-xs" style={{ color: '#8f9aa9' }}>{data?.alias || '-'}</div>
                  </div>
                ),
              },
              { key: 'provider', label: '供应商', children: 'KubeSpoke' },
              { key: 'version', label: 'Kubernetes 版本', children: data?.version ?? '-' },
              {
                key: 'description',
                label: '描述',
                span: 'filled',
                children: <span className="whitespace-pre-wrap">{data?.description || '-'}</span>,
              },
            ]}
          />
        </Spin>
      </Panel>

      <Modal
        open={open}
        title="编辑信息"
        okText="保存"
        okButtonProps={{ style: PRIMARY_BTN }}
        confirmLoading={saving}
        onCancel={() => setOpen(false)}
        onOk={doSave}
      >
        <Form form={form} layout="vertical" size="small" className="mt-3">
          <Form.Item name="alias" label="别名" extra="用于在集群列表中辨识，留空则不显示。">
            <Input maxLength={63} placeholder="请输入集群别名" allowClear />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea rows={3} maxLength={280} showCount placeholder="请输入集群描述" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}

/** 集群设置 → 基本信息 路由页：横幅页头 + 整页正文 */
export default function BaseInfoPage() {
  const cluster = useClusterStore((s) => s.cluster)
  const [reloadKey, setReloadKey] = useState(0)

  if (!cluster) return <Empty description="请先选择一个在线集群" className="py-24" />

  return (
    <div className="space-y-4">
      {/* 页头横幅 */}
      <div
        className="relative flex items-center justify-between overflow-hidden rounded-lg px-6 py-5"
        style={{ background: BANNER_BG }}
      >
        <div className="flex items-center gap-4">
          <span className="grid size-14 shrink-0 place-items-center rounded-xl text-2xl text-white" style={{ background: ICON_BRICK }}>
            <ClusterOutlined />
          </span>
          <div>
            <div className="text-xl font-bold" style={{ color: '#15233a' }}>基本信息</div>
            <div className="mt-1 text-[13px]" style={{ color: '#6b7a92' }}>
              查看集群名称、供应商与 Kubernetes 版本，别名和描述保存在 kube-system 命名空间的注解上。
            </div>
          </div>
        </div>
        <Button type="text" icon={<ReloadOutlined />} onClick={() => setReloadKey((k) => k + 1)} />
      </div>

      <ClusterBaseInfo key={reloadKey} cluster={cluster} />
    </div>
  )
}
