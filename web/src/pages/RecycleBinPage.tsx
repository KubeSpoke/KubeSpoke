import { DeleteOutlined } from '@ant-design/icons'
import { App, Button, Input, Select, Table, Tag, Typography } from 'antd'
import type { TableColumnsType } from 'antd'
import { useState } from 'react'
import { agentApi } from '../api/cluster'
import { recycleApi } from '../api/recycle'
import type { DeletedRow } from '../api/recycle'
import { DetailDrawer } from '../components/DetailDrawer'
import { PageShell } from '../components/PageShell'
import { useResource } from '../hooks/useResource'
import { datetime } from '../utils/format'

const TAKE = 50

/** 还原出来是空卷的种类：快照能还原配置，还原不了数据 */
const VOLUME_KINDS = ['PersistentVolumeClaim', 'PersistentVolume']

export default function RecycleBinPage() {
  const { message, modal } = App.useApp()
  const [keywordInput, setKeywordInput] = useState('')
  const [keyword, setKeyword] = useState('')
  const [cluster, setCluster] = useState<string>()
  const [page, setPage] = useState(1)
  const [viewing, setViewing] = useState<DeletedRow | null>(null)
  const [viewYaml, setViewYaml] = useState('')

  const clusters = useResource(() => agentApi.online().then((a) => a ?? []), [])

  const { data, error, loading, refresh } = useResource(
    () => recycleApi.list({ cluster, keyword: keyword || undefined, take: TAKE, skip: (page - 1) * TAKE }),
    [cluster, keyword, page],
  )

  const restore = (row: DeletedRow) => {
    modal.confirm({
      title: `把 ${row.kind}/${row.name} 还原回 ${row.namespace || row.cluster} 吗？`,
      content: VOLUME_KINDS.includes(row.kind)
        ? '存储卷类对象还原出来的是新卷，原来卷里的数据不会跟着回来。'
        : '按删除前抓到的快照重新创建该对象；同名对象已经存在时会拒绝还原。',
      okText: '还原',
      onOk: async () => {
        await recycleApi.restore(row.id)
        message.success('已还原')
        refresh()
      },
    })
  }

  const drop = (row: DeletedRow) => {
    modal.confirm({
      title: `丢弃 ${row.name} 的快照？`,
      content: '丢弃之后就再也还原不了这个对象了。',
      okText: '丢弃',
      okButtonProps: { danger: true },
      onOk: async () => {
        await recycleApi.drop(row.id)
        message.success('已丢弃')
        refresh()
      },
    })
  }

  const openYaml = async (row: DeletedRow) => {
    setViewing(row)
    setViewYaml('')
    const res = await recycleApi.yaml(row.id)
    setViewYaml(res?.yaml ?? '')
  }

  const onSearch = (value: string) => {
    setKeyword(value.trim())
    setPage(1)
  }

  const columns: TableColumnsType<DeletedRow> = [
    {
      key: 'time',
      title: '删除时间',
      width: 160,
      render: (_, r) => <span className="whitespace-nowrap text-xs">{datetime(r.time)}</span>,
    },
    { key: 'actor', title: '操作人', width: 90, render: (_, r) => r.actor || '-' },
    { key: 'cluster', title: '集群', width: 100, render: (_, r) => r.cluster || '-' },
    { key: 'namespace', title: '命名空间', width: 120, render: (_, r) => r.namespace || '-' },
    { key: 'kind', title: '类型', width: 130, render: (_, r) => <Typography.Text code>{r.kind}</Typography.Text> },
    {
      key: 'name',
      title: '名称',
      ellipsis: true,
      render: (_, r) => (
        <Button type="link" size="small" className="!px-0" onClick={() => openYaml(r)}>
          {r.name}
        </Button>
      ),
    },
    {
      key: 'expires',
      title: '状态',
      width: 150,
      render: (_, r) =>
        r.restored ? (
          <Tag color="green" variant="filled">
            已还原
          </Tag>
        ) : (
          <span className="whitespace-nowrap text-xs text-[#8f9aa9]">{datetime(r.expires)} 过期</span>
        ),
    },
    {
      key: 'actions',
      title: '操作',
      width: 130,
      render: (_, r) =>
        r.restored ? null : (
          <span className="flex items-center gap-1">
            <Button type="link" size="small" className="!px-0" onClick={() => restore(r)}>
              还原
            </Button>
            <Button type="link" size="small" danger className="!px-0" onClick={() => drop(r)}>
              丢弃
            </Button>
          </span>
        ),
    },
  ]

  return (
    <>
      <PageShell
        title="回收站"
        description={`删除前先把对象存成快照，${data?.keepDays ?? 7} 天内可还原；Pod、副本集、项目、节点、保密字典不留快照。`}
        icon={<DeleteOutlined />}
        namespaced={false}
        error={error}
        loading={loading}
        onRefresh={refresh}
        flush
        search={
          <div className="flex flex-wrap items-center gap-2">
            <Input.Search
              style={{ width: 240 }}
              placeholder="搜索名称、类型、命名空间…"
              allowClear
              value={keywordInput}
              onChange={(e) => {
                setKeywordInput(e.target.value)
                if (!e.target.value) onSearch('')
              }}
              onSearch={onSearch}
            />
            <Select
              style={{ width: 160 }}
              placeholder="全部集群"
              allowClear
              suffixIcon={null}
              variant="filled"
              value={cluster}
              onChange={(v) => {
                setCluster(v)
                setPage(1)
              }}
              options={(clusters.data ?? []).map((c) => ({ label: c.name, value: c.name }))}
            />
          </div>
        }
      >
        <Table<DeletedRow>
          rowKey="id"
          size="small"
          loading={loading}
          dataSource={data?.items ?? []}
          scroll={{ x: 1000 }}
          locale={{ emptyText: '回收站是空的' }}
          pagination={{
            current: page,
            pageSize: TAKE,
            total: data?.total ?? 0,
            showSizeChanger: false,
            showTotal: (t) => `共 ${t} 条`,
            onChange: (p) => setPage(p),
          }}
          columns={columns}
        />
      </PageShell>

      <DetailDrawer
        open={!!viewing}
        title={viewing ? `${viewing.kind} / ${viewing.name}` : ''}
        onClose={() => setViewing(null)}
        actions={
          viewing && !viewing.restored ? (
            <Button type="primary" size="small" onClick={() => restore(viewing)}>
              还原
            </Button>
          ) : null
        }
      >
        <pre className="kbd-mono m-0 overflow-auto p-4 text-xs leading-5">{viewYaml || '加载中…'}</pre>
      </DetailDrawer>
    </>
  )
}
