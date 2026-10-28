import { AlertOutlined } from '@ant-design/icons'
import { App, Button, Divider, Dropdown, Input, Modal, Select, Space, Table, Tabs, Tag, Tooltip, Typography } from 'antd'
import { useCallback, useEffect, useState } from 'react'
import { alertApi } from '../api/alerts'
import type { AlertChannel, AlertNotifyLog, AlertRow } from '../api/alerts'
import { agentApi } from '../api/cluster'
import { NameCell, PageShell } from '../components/PageShell'
import { useResource } from '../hooks/useResource'
import { datetime } from '../utils/format'

type TabKey = 'active' | 'resolved' | 'all'

const TABS: { key: TabKey; label: string }[] = [
  { key: 'active', label: '在告' },
  { key: 'resolved', label: '已恢复' },
  { key: 'all', label: '全部' },
]

/** 一次只取一页；服务端按 take/skip 分页，总数在响应里 */
const PAGE_SIZE = 100
const REFRESH_MS = 60_000

const SEVERITY_OPTIONS = [
  { label: '全部', value: '' },
  { label: 'critical', value: 'critical' },
  { label: 'warning', value: 'warning' },
]

const stillFiring = (r: AlertRow) => !r.resolvedAt

/** 静默期内不再对外推送、也不计进未确认角标；服务端存的是 UTC，这里比的是本地时间串 */
const isMuted = (r: AlertRow) => !!r.muteUntil && new Date(r.muteUntil).getTime() > Date.now()

const MUTE_OPTIONS = [
  { label: '静默 30 分钟', minutes: 30 },
  { label: '静默 2 小时', minutes: 120 },
  { label: '静默 8 小时', minutes: 480 },
  { label: '静默 24 小时', minutes: 1440 },
]

function SeverityTag({ severity }: { severity: string }) {
  return (
    <Tag color={severity === 'critical' ? 'red' : 'orange'} variant="filled" style={{ margin: 0 }}>
      {severity}
    </Tag>
  )
}

function AlertState({ row }: { row: AlertRow }) {
  if (row.resolvedAt) {
    return (
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        已恢复 {datetime(row.resolvedAt)}
      </Typography.Text>
    )
  }
  if (isMuted(row)) {
    return (
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        静默至 {datetime(row.muteUntil)}
      </Typography.Text>
    )
  }
  if (row.acked) {
    return (
      <Tag color="blue" variant="filled" style={{ margin: 0 }}>
        已确认{row.ackedBy ? ` · ${row.ackedBy}` : ''}
      </Tag>
    )
  }
  return <Tag color="red" variant="filled" style={{ margin: 0 }}>在告</Tag>
}

export default function AlertsPage() {
  const { message, modal } = App.useApp()
  const [tab, setTab] = useState<TabKey>('active')
  const [cluster, setCluster] = useState<string>()
  const [severity, setSeverity] = useState<string>()
  const [page, setPage] = useState(1)
  const [tick, setTick] = useState(0)
  const [acking, setAcking] = useState<number>()
  const [muting, setMuting] = useState<number>()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [channelUrl, setChannelUrl] = useState('')
  const [addingChannel, setAddingChannel] = useState(false)

  const clusters = useResource(() => agentApi.online().then((a) => a ?? []), [])

  const { data, error, loading, refresh } = useResource(
    () =>
      alertApi.list({
        state: tab,
        ...(cluster ? { cluster } : {}),
        ...(severity ? { severity: severity as 'critical' | 'warning' } : {}),
        take: PAGE_SIZE,
        skip: (page - 1) * PAGE_SIZE,
      }),
    [tab, cluster, severity, page, tick],
  )

  /** 只有「在告」页跟着采集节奏自己刷，另外两页是历史，没必要轮询 */
  useEffect(() => {
    if (tab !== 'active') return
    const timer = setInterval(() => setTick((t) => t + 1), REFRESH_MS)
    return () => clearInterval(timer)
  }, [tab])

  /** 渠道列表只在弹窗打开时拉一次，关闭态 loader 直接返回空、不发请求也不轮询 */
  const channelList = useResource(
    () =>
      settingsOpen
        ? alertApi.channels()
        : Promise.resolve<{ items: AlertChannel[] }>({ items: [] }),
    [settingsOpen],
  )

  /** 投递回执同理：只在弹窗开着的时候取最近二十条 */
  const receipts = useResource(
    () =>
      settingsOpen
        ? alertApi.notifyLogs(20)
        : Promise.resolve<{ items: AlertNotifyLog[] }>({ items: [] }),
    [settingsOpen],
  )

  const ack = useCallback(
    async (row: AlertRow) => {
      setAcking(row.id)
      try {
        await alertApi.ack(row.id)
        message.success(`已确认 ${row.cluster} / ${row.resource}`)
        refresh()
      } catch (e) {
        message.error((e as Error).message)
      } finally {
        setAcking(undefined)
      }
    },
    [message, refresh],
  )

  /** 静默只是压掉对外推送和角标，库里这条照旧跟着采集走 */
  const mute = useCallback(
    async (row: AlertRow, minutes: number) => {
      setMuting(row.id)
      try {
        await alertApi.mute(row.id, minutes)
        message.success(
          minutes ? `已静默 ${row.resource}，${minutes} 分钟内不再推送` : `已取消静默 ${row.resource}`,
        )
        refresh()
      } catch (e) {
        message.error((e as Error).message)
      } finally {
        setMuting(undefined)
      }
    },
    [message, refresh],
  )

  const addChannel = useCallback(async () => {    const url = channelUrl.trim()
    if (!url) return
    setAddingChannel(true)
    try {
      await alertApi.addChannel(url)
      message.success('已添加通知地址')
      setChannelUrl('')
      channelList.refresh()
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setAddingChannel(false)
    }
  }, [channelUrl, message, channelList.refresh])

  const removeChannel = useCallback(
    (c: AlertChannel) => {
      modal.confirm({
        title: '删除该通知地址？',
        content: c.url,
        okText: '删除',
        okButtonProps: { danger: true },
        onOk: async () => {
          try {
            await alertApi.removeChannel(c.id)
            channelList.refresh()
          } catch (e) {
            message.error((e as Error).message)
          }
        },
      })
    },
    [modal, message, channelList.refresh],
  )

  /** 换页签或换过滤条件都等于重开一次查询，一律回到第一页 */
  const changeTab = (key: string) => {
    setTab(key as TabKey)
    setPage(1)
  }
  const changeCluster = (value?: string) => {
    setCluster(value)
    setPage(1)
  }
  const changeSeverity = (value: string) => {
    setSeverity(value || undefined)
    setPage(1)
  }

  const rows = data?.items ?? []

  return (
    <PageShell
      title="告警中心"
      description="每分钟采集各在线集群的节点、容器、副本数与 Warning 事件异常。"
      icon={<AlertOutlined />}
      namespaced={false}
      error={error}
      onRefresh={refresh}
      loading={loading}
      stats={<Tabs activeKey={tab} onChange={changeTab} items={TABS} />}
      search={
        <Space size={8} wrap>
          <Typography.Text type="secondary" style={{ fontSize: 13 }}>
            集群
          </Typography.Text>
          <Select
            allowClear
            placeholder="全部"
            style={{ width: 180 }}
            variant="filled"
            value={cluster}
            onChange={changeCluster}
            loading={clusters.loading}
            options={clusters.data?.map((a) => ({ label: a.name, value: a.name })) ?? []}
          />
          <Typography.Text type="secondary" style={{ fontSize: 13 }}>
            级别
          </Typography.Text>
          <Select
            placeholder="全部"
            style={{ width: 120 }}
            variant="filled"
            value={severity ?? ''}
            onChange={changeSeverity}
            options={SEVERITY_OPTIONS}
          />
          <Button onClick={() => setSettingsOpen(true)}>通知设置</Button>
        </Space>
      }
      flush
    >
      <Table<AlertRow>
        rowKey="id"
        size="small"
        loading={loading}
        dataSource={rows}
        scroll={{ x: 1150 }}
        locale={{ emptyText: tab === 'active' ? '当前没有在告的异常' : '没有匹配的告警' }}
        pagination={{
          current: page,
          pageSize: PAGE_SIZE,
          total: data?.total ?? 0,
          showSizeChanger: false,
          showTotal: (t) => `共 ${t} 条`,
          hideOnSinglePage: true,
          onChange: setPage,
        }}
        columns={[
          {
            key: 'severity',
            title: '级别',
            width: 80,
            render: (_, r) => <SeverityTag severity={r.severity} />,
          },
          {
            key: 'cluster',
            title: '集群',
            width: 110,
            render: (_, r) => (
              <span className="block truncate" style={{ color: 'var(--ks-ink)' }} title={r.cluster}>
                {r.cluster}
              </span>
            ),
          },
          {
            key: 'object',
            title: '对象',
            width: 230,
            render: (_, r) => (
              <NameCell
                title={r.namespace ? `${r.namespace} / ${r.resource}` : r.resource}
                sub={r.kind}
              />
            ),
          },
          {
            key: 'reason',
            title: '原因',
            width: 130,
            render: (_, r) => (
              <span className="block truncate" style={{ color: 'var(--ks-ink)' }} title={r.reason}>
                {r.reason || '-'}
              </span>
            ),
          },
          {
            key: 'message',
            title: '说明',
            ellipsis: true,
            render: (_, r) => (
              <Tooltip title={r.message} placement="topLeft">
                <span className="block truncate text-xs" style={{ color: 'var(--ks-body)' }}>
                  {r.message || '-'}
                </span>
              </Tooltip>
            ),
          },
          { key: 'count', title: '次数', width: 60, render: (_, r) => r.count },
          {
            key: 'lastSeen',
            title: '最近发生',
            width: 150,
            render: (_, r) => (
              <span className="whitespace-nowrap text-xs" style={{ color: 'var(--ks-body)' }}>
                {datetime(r.lastSeen)}
              </span>
            ),
          },
          { key: 'state', title: '状态', width: 150, render: (_, r) => <AlertState row={r} /> },
          {
            key: 'actions',
            title: '操作',
            width: 120,
            render: (_, r) =>
              stillFiring(r) ? (
                <Space size={0}>
                  {!r.acked && (
                    <Button
                      size="small"
                      type="link"
                      style={{ paddingLeft: 0 }}
                      loading={acking === r.id}
                      onClick={() => void ack(r)}
                    >
                      确认
                    </Button>
                  )}
                  <Dropdown
                    trigger={['click']}
                    menu={{
                      items: [
                        ...MUTE_OPTIONS.map((o) => ({
                          key: String(o.minutes),
                          label: o.label,
                          onClick: () => void mute(r, o.minutes),
                        })),
                        { type: 'divider' as const },
                        {
                          key: 'unmute',
                          label: '取消静默',
                          disabled: !isMuted(r),
                          onClick: () => void mute(r, 0),
                        },
                      ],
                    }}
                  >
                    <Button
                      size="small"
                      type="link"
                      loading={muting === r.id}
                      style={r.acked ? { paddingLeft: 0 } : undefined}
                    >
                      静默
                    </Button>
                  </Dropdown>
                </Space>
              ) : (
                <span className="text-xs" style={{ color: 'var(--ks-faint)' }}>
                  —
                </span>
              ),
          },
        ]}
      />

      <Modal
        title="通知设置"
        width={640}
        open={settingsOpen}
        footer={null}
        onCancel={() => setSettingsOpen(false)}
      >
        <div className="flex flex-col gap-0.5">
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            每轮采集有新告警或恢复时，会向下列地址 POST 一份 JSON。
          </Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            请求体形如{' '}
            <span className="kbd-mono">{`{ source, firing: [...], resolved: [...] }`}</span>
          </Typography.Text>
        </div>

        <div className="mt-4 flex flex-col gap-1">
          {(channelList.data?.items ?? []).map((c) => (
            <div key={c.id} className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate" style={{ color: 'var(--ks-ink)' }} title={c.url}>
                {c.url}
              </span>
              <Button
                size="small"
                type="link"
                danger
                style={{ paddingLeft: 0 }}
                onClick={() => removeChannel(c)}
              >
                删除
              </Button>
            </div>
          ))}
          {!channelList.loading && (channelList.data?.items.length ?? 0) === 0 && (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              还没有配置通知地址
            </Typography.Text>
          )}
          {channelList.error && (
            <Typography.Text type="danger" style={{ fontSize: 12 }}>
              {channelList.error}
            </Typography.Text>
          )}
        </div>

        <Space.Compact className="mt-3 w-full">
          <Input
            placeholder="https://example.com/hook"
            value={channelUrl}
            onChange={(e) => setChannelUrl(e.target.value)}
            onPressEnter={() => void addChannel()}
          />
          <Button
            type="primary"
            loading={addingChannel}
            disabled={!channelUrl.trim()}
            onClick={() => void addChannel()}
          >
            添加
          </Button>
        </Space.Compact>

        <Divider style={{ margin: '20px 0 12px' }} />
        <Typography.Text strong style={{ fontSize: 13 }}>
          最近投递
        </Typography.Text>
        <Table<AlertNotifyLog>
          className="mt-2"
          size="small"
          rowKey="id"
          loading={receipts.loading}
          dataSource={receipts.data?.items ?? []}
          pagination={false}
          locale={{ emptyText: '还没有推送记录' }}
          scroll={{ x: 560 }}
          columns={[
            {
              title: '时间',
              width: 155,
              render: (_, l) => (
                <span className="whitespace-nowrap text-xs" style={{ color: 'var(--ks-body)' }}>
                  {datetime(l.time)}
                </span>
              ),
            },
            {
              title: '集群',
              width: 80,
              render: (_, l) => (
                <span className="block truncate" title={l.cluster}>
                  {l.cluster}
                </span>
              ),
            },
            {
              title: '条数',
              width: 130,
              render: (_, l) => (
                <span className="whitespace-nowrap text-xs">{`告警 ${l.firing} / 恢复 ${l.resolved}`}</span>
              ),
            },
            {
              title: '结果',
              render: (_, l) =>
                l.success ? (
                  <Tag color="green" variant="filled" style={{ margin: 0 }}>
                    送达
                  </Tag>
                ) : (
                  <Tooltip title={l.message}>
                    <Tag color="red" variant="filled" style={{ margin: 0 }}>
                      未送达
                    </Tag>
                  </Tooltip>
                ),
            },
          ]}
        />
      </Modal>
    </PageShell>
  )
}
