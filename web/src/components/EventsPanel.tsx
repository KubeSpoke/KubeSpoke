import { Segmented, Table, Tag, Typography } from 'antd'
import { useMemo, useState } from 'react'
import { resourceApi } from '../api/resources'
import { useResource } from '../hooks/useResource'
import { age, datetime } from '../utils/format'
import type { V1Event } from '../types/k8s'

/** 某对象的关联事件表（依赖后端 GetResourceEvents 保留 involvedObject） */
export function EventsPanel({ cluster, kind, name, namespace }: { cluster: string; kind: string; name: string; namespace?: string }) {
  const [type, setType] = useState<'all' | 'Warning'>('all')
  const { data, error, loading } = useResource(
    () => (cluster && name ? resourceApi.events(cluster, kind, name, namespace) : Promise.resolve([] as V1Event[])),
    [cluster, kind, name, namespace],
  )

  const rows = useMemo(() => {
    const list = (data ?? []).filter((e) => type === 'all' || e.type === 'Warning')
    return [...list].sort((a, b) => (b.lastTimestamp ?? '').localeCompare(a.lastTimestamp ?? ''))
  }, [data, type])

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        {error ? <Typography.Text type="danger">{error}</Typography.Text> : <span />}
        <Segmented
          size="small"
          value={type}
          onChange={(v) => setType(v as typeof type)}
          options={[
            { label: '全部', value: 'all' },
            { label: '仅 Warning', value: 'Warning' },
          ]}
        />
      </div>
      <Table<V1Event>
        rowKey={(r) => r.metadata?.uid ?? `${r.lastTimestamp}-${r.message}`}
        size="small"
        loading={loading}
        dataSource={rows}
        pagination={{ pageSize: 10, hideOnSinglePage: true, showTotal: (t) => `共 ${t} 条` }}
        columns={[
          { title: '类型', width: 90, render: (_, r) => <Tag color={r.type === 'Warning' ? 'red' : 'default'} variant="filled">{r.type}</Tag> },
          { title: '原因', dataIndex: 'reason', width: 160 },
          { title: '消息', dataIndex: 'message', ellipsis: true },
          { title: '次数', dataIndex: 'count', width: 60 },
          { title: '最近发生', width: 110, render: (_, r) => age(r.lastTimestamp) },
          { title: '首次', width: 165, render: (_, r) => datetime(r.firstTimestamp) },
        ]}
      />
    </div>
  )
}

export default EventsPanel
