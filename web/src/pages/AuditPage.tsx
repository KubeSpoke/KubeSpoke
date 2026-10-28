import { HistoryOutlined } from '@ant-design/icons'
import { Input, Select, Table, Tag, Tooltip, Typography } from 'antd'
import type { TableColumnsType } from 'antd'
import { useState } from 'react'
import { agentApi } from '../api/cluster'
import { auditApi } from '../api/audit'
import type { AuditRow } from '../api/audit'
import { PageShell } from '../components/PageShell'
import { useResource } from '../hooks/useResource'
import { datetime } from '../utils/format'

const TAKE = 50

type SuccessFilter = 'all' | 'success' | 'fail'

export default function AuditPage() {
  const [keywordInput, setKeywordInput] = useState('')
  const [keyword, setKeyword] = useState('')
  const [cluster, setCluster] = useState<string>()
  const [success, setSuccess] = useState<SuccessFilter>('all')
  const [page, setPage] = useState(1)

  const clusters = useResource(() => agentApi.online().then((a) => a ?? []), [])

  const { data, error, loading, refresh } = useResource(
    () =>
      auditApi.list({
        cluster,
        keyword: keyword || undefined,
        success: success === 'all' ? undefined : success === 'success',
        take: TAKE,
        skip: (page - 1) * TAKE,
      }),
    [cluster, keyword, success, page],
  )

  const onSearch = (value: string) => {
    setKeyword(value.trim())
    setPage(1)
  }

  const columns: TableColumnsType<AuditRow> = [
    {
      key: 'time',
      title: '时间',
      width: 160,
      render: (_, r) => <span className="whitespace-nowrap text-xs">{datetime(r.time)}</span>,
    },
    { key: 'actor', title: '操作人', width: 90, render: (_, r) => r.actor || '-' },
    {
      key: 'action',
      title: '操作',
      width: 160,
      render: (_, r) => <Typography.Text code>{r.action || '-'}</Typography.Text>,
    },
    { key: 'cluster', title: '集群', width: 90, render: (_, r) => r.cluster || '-' },
    { key: 'namespace', title: '命名空间', width: 120, render: (_, r) => r.namespace || '-' },
    { key: 'resource', title: '资源', width: 150, render: (_, r) => r.resource || '-' },
    {
      key: 'detail',
      title: '详情',
      ellipsis: true,
      render: (_, r) =>
        r.detail ? (
          <Tooltip title={r.detail}>
            <span>{r.detail}</span>
          </Tooltip>
        ) : (
          '-'
        ),
    },
    {
      key: 'result',
      title: '结果',
      width: 120,
      render: (_, r) =>
        r.success ? (
          <Tag color="green" variant="filled">
            成功
          </Tag>
        ) : (
          <Tooltip title={r.message || undefined}>
            <span className="inline-block max-w-full align-top">
              <Tag color="red" variant="filled">
                失败
              </Tag>
              {r.message && (
                <span className="block truncate text-xs text-[var(--ks-muted)]" style={{ maxWidth: 120 }}>
                  {r.message}
                </span>
              )}
            </span>
          </Tooltip>
        ),
    },
    { key: 'ip', title: 'IP', width: 100, render: (_, r) => <span className="kbd-mono text-xs">{r.ip || '-'}</span> },
  ]

  return (
    <PageShell
      title="审计日志"
      description="记录控制台内的写操作，只读查询不进入审计。"
      icon={<HistoryOutlined />}
      namespaced={false}
      error={error}
      loading={loading}
      onRefresh={refresh}
      flush
      search={
        <div className="flex flex-wrap items-center gap-2">
          <Input.Search
            style={{ width: 240 }}
            placeholder="搜索操作、资源、命名空间…"
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
          <Select
            style={{ width: 120 }}
            suffixIcon={null}
            variant="filled"
            value={success}
            onChange={(v) => {
              setSuccess(v as SuccessFilter)
              setPage(1)
            }}
            options={[
              { label: '全部', value: 'all' },
              { label: '成功', value: 'success' },
              { label: '失败', value: 'fail' },
            ]}
          />
        </div>
      }
    >
      <Table<AuditRow>
        rowKey="id"
        size="small"
        loading={loading}
        dataSource={data?.items ?? []}
        scroll={{ x: 1100 }}
        locale={{ emptyText: '没有匹配的审计日志' }}
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
  )
}
