import { App, Button, Empty, Form, Input, Modal, Radio, Select, Table, Typography } from 'antd'
import { ApartmentOutlined, EditOutlined, GlobalOutlined, ReloadOutlined } from '@ant-design/icons'
import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { resourceApi, toItems } from '../../api/resources'
import { NameCell } from '../../components/PageShell'
import type { ResourceDescriptor } from '../../config/nav'
import { useResource } from '../../hooks/useResource'
import { useClusterStore } from '../../store/useClusterStore'
import { datetime } from '../../utils/format'
import { toYaml } from '../../utils/yaml'

/** 集群可见性约定（与「基本信息」页 / 概览页共用）：落在 kube-system 命名空间注解上 */
const ANNO_VISIBILITY = 'kubespoke.io/visibility'
const ANNO_VISIBILITY_PROJECTS = 'kubespoke.io/visibility-projects'
const CLUSTER_META_NAMESPACE = 'kube-system'
/** 项目（命名空间）自身的展示字段沿用 KubeSphere 注解 */
const ANNO_PROJECT_ALIAS = 'kubesphere.io/alias-name'
const ANNO_PROJECT_CREATOR = 'kubesphere.io/creator'

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

type Visibility = 'public' | 'limited'

interface ProjectRow {
  name: string
  alias: string
  creator: string
  creationTimestamp?: string
}

/** 视觉 token：与节点管理页同一套语言 */
const BANNER_BG = 'linear-gradient(90deg, #f2f7ff 0%, #e9f1fd 60%, #eef4fe 100%)'
const ICON_BRICK = 'linear-gradient(135deg, #5ea0ff, #1668dc)'
const PRIMARY_BTN = { background: 'linear-gradient(90deg, #3f8cff, #1f5fe0)', borderColor: '#1f5fe0' }
const TONE = { ok: '#59c492', warn: '#f5a623', danger: '#d94f4f', muted: '#9aa7b8' }

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

/** kube-system 原对象整体转 YAML 提交（同列表页「编辑 YAML」惯例），值为空即删除该注解 */
async function patchClusterAnnotations(cluster: string, patch: Record<string, string | null>): Promise<void> {
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

export default function VisibilityPage() {
  const { message } = App.useApp()
  const cluster = useClusterStore((s) => s.cluster)
  const storeNamespaces = useClusterStore((s) => s.namespaces)
  const [form] = Form.useForm<{ visibility: Visibility; projects: string[] }>()
  const watched = Form.useWatch('visibility', form)
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [filter, setFilter] = useState('')

  const { data, error, loading, refresh } = useResource<{ visibility: Visibility; projects: string[]; rows: ProjectRow[] }>(
    async () => {
      if (!cluster) return { visibility: 'public', projects: [], rows: [] }
      const [meta, list] = await Promise.all([
        resourceApi.read(cluster, NAMESPACES, CLUSTER_META_NAMESPACE).catch(() => undefined),
        // core 组列表在部分集群会走 CustomObjects 回落，失败后由 store 的类型化命名空间列表兜底
        resourceApi.list(cluster, NAMESPACES).catch(() => undefined),
      ])
      const ann = meta?.metadata?.annotations ?? {}
      const visibility: Visibility = ann[ANNO_VISIBILITY] === 'limited' ? 'limited' : 'public'
      const projects = (ann[ANNO_VISIBILITY_PROJECTS] ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)

      const items = toItems(list)
      const rows: ProjectRow[] = items.length
        ? items
            .map((o) => ({
              name: o.metadata?.name ?? '-',
              alias: o.metadata?.annotations?.[ANNO_PROJECT_ALIAS] ?? '',
              creator: o.metadata?.annotations?.[ANNO_PROJECT_CREATOR] ?? '',
              creationTimestamp: o.metadata?.creationTimestamp,
            }))
            .sort((a, b) => a.name.localeCompare(b.name))
        : (storeNamespaces ?? []).map((n) => ({ name: n.name, alias: '', creator: '', creationTimestamp: n.creationTime }))

      return { visibility, projects, rows }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cluster, storeNamespaces.length],
  )

  const limited = data?.visibility === 'limited'

  /** 「对当前集群可见」的项目集合：公有=全部，limited=注解名单内 */
  const visibleRows = useMemo(() => {
    const rows = (data?.rows ?? []).filter((r) => (limited ? (data?.projects ?? []).includes(r.name) : true))
    if (!filter.trim()) return rows
    const q = filter.trim().toLowerCase()
    return rows.filter((r) => r.name.toLowerCase().includes(q) || r.alias.toLowerCase().includes(q))
  }, [data, limited, filter])

  if (!cluster) return <Empty description="请先选择一个在线集群" className="py-24" />

  const openEdit = () => {
    form.setFieldsValue({ visibility: data?.visibility ?? 'public', projects: data?.projects ?? [] })
    setOpen(true)
  }

  const doSave = async () => {
    let values: { visibility: Visibility; projects?: string[] }
    try {
      values = await form.validateFields()
    } catch {
      return
    }
    setSaving(true)
    try {
      await patchClusterAnnotations(cluster, {
        [ANNO_VISIBILITY]: values.visibility,
        // 公有时清掉项目名单
        [ANNO_VISIBILITY_PROJECTS]: values.visibility === 'limited' ? (values.projects ?? []).join(',') : null,
      })
      message.success('已更新集群可见性')
      setOpen(false)
      refresh()
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const tone = limited ? TONE.warn : TONE.ok
  const toneText = limited ? '#c47f0a' : '#27a06a'

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error} <Button size="small" onClick={refresh}>重试</Button>
        </div>
      )}

      {/* 页头横幅 */}
      <div
        className="relative flex items-center justify-between overflow-hidden rounded-lg px-6 py-5"
        style={{ background: BANNER_BG }}
      >
        <div className="flex items-center gap-4">
          <span className="grid size-14 shrink-0 place-items-center rounded-xl text-2xl text-white" style={{ background: ICON_BRICK }}>
            <GlobalOutlined />
          </span>
          <div>
            <div className="text-xl font-bold" style={{ color: '#15233a' }}>集群可见性</div>
            <div className="mt-1 text-[13px]" style={{ color: '#6b7a92' }}>
              可见性写在 kube-system 命名空间的注解上，决定哪些项目能在本集群中被访问。
            </div>
          </div>
        </div>
        <Button type="text" icon={<ReloadOutlined />} onClick={refresh} loading={loading} />
      </div>

      {/* 当前可见性状态 */}
      <Panel
        title="当前可见性"
        description={`当前集群：${cluster}`}
        extra={
          <Button size="small" type="primary" icon={<EditOutlined />} style={PRIMARY_BTN} onClick={openEdit}>
            编辑可见性
          </Button>
        }
      >
        <div className="flex flex-wrap items-center gap-3">
          <span
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[13px] font-medium"
            style={{ background: `${tone}1a`, color: toneText }}
          >
            <span className="size-[7px] rounded-full" style={{ background: tone }} />
            {limited ? '对部分项目可见' : '公有'}
          </span>
          <span className="text-xs" style={{ color: '#8f9aa9' }}>
            {limited ? (
              data?.projects?.length ? (
                <span className="kbd-mono">可见项目：{data.projects.join('、')}</span>
              ) : (
                '当前没有可见项目（名单为空）'
              )
            ) : (
              '所有项目均可见'
            )}
          </span>
        </div>
      </Panel>

      {/* 可见项目列表 */}
      <div className="rounded-lg bg-white" style={{ border: '1px solid #e6ebf1' }}>
        <div className="flex flex-wrap items-center justify-between gap-3 px-4" style={{ minHeight: 48, borderBottom: '1px solid #eef1f5' }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: '#15233a' }}>可见项目</span>
          <Input.Search
            className="ks-search"
            placeholder="输入名称进行过滤"
            allowClear
            size="small"
            style={{ width: 260 }}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
        <Table<ProjectRow>
          rowKey="name"
          size="small"
          loading={loading}
          dataSource={visibleRows}
          scroll={{ x: 720 }}
          pagination={{ pageSize: 10, showSizeChanger: false, showTotal: (total) => `每页显示：10 / 总数：${total}` }}
          locale={{ emptyText: limited ? '暂无可见项目，可在「编辑可见性」中勾选' : '暂无项目' }}
          columns={[
            {
              title: '名称',
              render: (_, r) => <NameCell icon={<ApartmentOutlined />} title={r.name} sub={r.alias || '-'} />,
            },
            { title: '管理员', width: 200, render: (_, r) => r.creator || 'admin' },
            { title: '创建时间', width: 220, render: (_, r) => datetime(r.creationTimestamp) },
          ]}
        />
      </div>

      <Modal
        open={open}
        title="编辑可见性"
        okText="保存"
        okButtonProps={{ style: PRIMARY_BTN }}
        confirmLoading={saving}
        onCancel={() => setOpen(false)}
        onOk={doSave}
      >
        <Form form={form} layout="vertical" size="small" className="mt-3">
          <Form.Item name="visibility" label="可见性">
            <Radio.Group
              options={[
                { label: '公有', value: 'public' },
                { label: '对部分项目可见', value: 'limited' },
              ]}
            />
          </Form.Item>
          {watched === 'limited' && (
            <Form.Item
              name="projects"
              label="可见项目"
              extra="仅勾选的项目可以在本集群中被访问。"
              rules={[{ required: true, message: '请至少选择一个项目' }]}
            >
              <Select
                mode="multiple"
                allowClear
                optionFilterProp="label"
                placeholder="选择可见的项目"
                maxTagCount="responsive"
                options={(data?.rows ?? []).map((r) => ({
                  label: r.alias ? `${r.name}（${r.alias}）` : r.name,
                  value: r.name,
                }))}
              />
            </Form.Item>
          )}
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            公有集群对所有项目开放；改为「对部分项目可见」后未勾选的项目将从本集群的管理范围中隐藏。
          </Typography.Text>
        </Form>
      </Modal>
    </div>
  )
}
