import { ApiOutlined, DeleteOutlined, MinusCircleOutlined, PlusOutlined } from '@ant-design/icons'
import {
  App,
  Button,
  Divider,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Table,
  Tooltip,
  Typography,
} from 'antd'
import { useCallback, useEffect, useState } from 'react'
import { tunnelApi } from '../api/tunnel'
import type { TunnelCreatePayload, TunnelRow, TunnelStatus } from '../api/tunnel'
import { NameCell, PageShell, StatusDot } from '../components/PageShell'
import { useClusterStore } from '../store/useClusterStore'
import { useResource } from '../hooks/useResource'
import { datetime } from '../utils/format'

interface FormShape {
  name: string
  namespace: string
  serverAddr: string
  serverPort: number
  token?: string
  image?: string
  webs?: { localIp: string; localPort: number; subDomain: string }[]
  forwards?: { localIp: string; localPort: number; remotePort: number; protocol: string }[]
}

/** 状态色沿用 KubeSphere：Running/Ready 绿、Pending 橙、Failed 红、Unknown 灰 */
export default function TunnelsPage() {
  const { message, modal } = App.useApp()
  const cluster = useClusterStore((s) => s.cluster)
  const [createOpen, setCreateOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [deleting, setDeleting] = useState<number>()
  const [statuses, setStatuses] = useState<Record<number, TunnelStatus>>({})
  const [form] = Form.useForm<FormShape>()

  const { data, error, loading, refresh } = useResource(
    () => (cluster ? tunnelApi.list(cluster) : Promise.resolve({ items: [] as TunnelRow[] })),
    [cluster],
  )

  const rows = data?.items ?? []

  /** 列表到位后并行拉每条隧道的实时 Pod 状态；单条失败回 Unknown，不影响整表 */
  const loadStatuses = useCallback(
    async (list: TunnelRow[]) => {
      if (list.length === 0) {
        setStatuses({})
        return
      }
      const entries = await Promise.all(
        list.map(async (t) => {
          try {
            return [t.id, await tunnelApi.status(t.id)] as const
          } catch {
            return [t.id, { id: t.id, podName: t.podName, phase: 'Unknown', ready: false } as TunnelStatus] as const
          }
        }),
      )
      setStatuses(Object.fromEntries(entries))
    },
    [],
  )

  useEffect(() => {
    void loadStatuses(rows)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data])

  const openCreate = useCallback(async () => {
    setCreateOpen(true)
    form.resetFields()
    try {
      const defaults = await tunnelApi.defaults()
      form.setFieldsValue({
        namespace: 'default',
        serverPort: defaults.serverPort || 1270,
        image: defaults.image,
        webs: [],
        forwards: [],
      })
    } catch {
      form.setFieldsValue({ namespace: 'default', serverPort: 1270, webs: [], forwards: [] })
    }
  }, [form])

  const submit = useCallback(async () => {
    let values: FormShape
    try {
      values = await form.validateFields()
    } catch {
      return
    }
    const webs = values.webs ?? []
    const forwards = values.forwards ?? []
    if (webs.length === 0 && forwards.length === 0) {
      message.error('至少要配置一条 Web 穿透或端口转发')
      return
    }
    setSubmitting(true)
    try {
      const payload: TunnelCreatePayload = {
        clustName: cluster,
        name: values.name.trim(),
        namespace: (values.namespace || 'default').trim(),
        image: values.image?.trim() || undefined,
        serverAddr: values.serverAddr.trim(),
        serverPort: Number(values.serverPort),
        token: values.token?.trim() || undefined,
        webs: webs.map((w) => ({ localIp: w.localIp, localPort: Number(w.localPort), subDomain: w.subDomain })),
        forwards: forwards.map((f) => ({
          localIp: f.localIp,
          localPort: Number(f.localPort),
          remotePort: Number(f.remotePort),
          protocol: f.protocol || 'TCP',
        })),
      }
      await tunnelApi.create(payload)
      message.success('隧道已创建，Pod 拉起中')
      setCreateOpen(false)
      refresh()
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setSubmitting(false)
    }
  }, [cluster, form, message, refresh])

  const remove = useCallback(
    (row: TunnelRow) => {
      modal.confirm({
        title: '删除该隧道？',
        content: `将销毁集群里的 ${row.namespace}/${row.podName}，穿透随即断开。`,
        okText: '删除',
        okButtonProps: { danger: true },
        onOk: async () => {
          setDeleting(row.id)
          try {
            await tunnelApi.delete(row.id)
            message.success('已删除')
            refresh()
          } catch (e) {
            message.error((e as Error).message)
          } finally {
            setDeleting(undefined)
          }
        },
      })
    },
    [modal, message, refresh],
  )

  return (
    <PageShell
      title="内网穿透"
      description="通过 agent 在集群里拉起 fasttunnel-client Pod，连接外部 FastTunnel 服务端，把内网服务暴露到公网。"
      icon={<ApiOutlined />}
      namespaced={false}
      error={error}
      loading={loading}
      onRefresh={() => {
        refresh()
        void loadStatuses(rows)
      }}
      actions={
        <Button type="primary" icon={<PlusOutlined />} disabled={!cluster} onClick={() => void openCreate()}>
          新建隧道
        </Button>
      }
      flush
    >
      <Table<TunnelRow>
        rowKey="id"
        size="small"
        loading={loading}
        dataSource={rows}
        scroll={{ x: 1000 }}
        locale={{ emptyText: cluster ? '还没有隧道，点右上角新建' : '请先选择集群' }}
        pagination={{ hideOnSinglePage: true, showTotal: (t) => `共 ${t} 条` }}
        columns={[
          {
            key: 'name',
            title: '隧道',
            width: 220,
            render: (_, r) => <NameCell title={r.name} sub={`${r.namespace}/${r.podName}`} />,
          },
          {
            key: 'phase',
            title: '状态',
            width: 130,
            render: (_, r) => {
              const s = statuses[r.id]
              return <StatusDot phase={s?.phase ?? 'Unknown'} extra={s?.ready ? 'ready' : undefined} />
            },
          },
          {
            key: 'server',
            title: 'FastTunnel 服务端',
            width: 200,
            render: (_, r) => (
              <span className="kbd-mono text-xs" style={{ color: '#5b6a80' }}>
                {r.serverAddr}:{r.serverPort}
                {r.hasToken ? ' · token' : ''}
              </span>
            ),
          },
          {
            key: 'webs',
            title: 'Web 穿透 (HTTP)',
            render: (_, r) =>
              r.webs.length === 0 ? (
                <span className="text-xs" style={{ color: '#c2cbd8' }}>—</span>
              ) : (
                <div className="flex flex-col gap-0.5">
                  {r.webs.map((w, i) => (
                    <span key={i} className="kbd-mono text-xs" style={{ color: '#5b6a80' }}>
                      {w.subDomain}.{r.serverAddr}:{r.serverPort} ⇒ {w.localIp}:{w.localPort}
                    </span>
                  ))}
                </div>
              ),
          },
          {
            key: 'forwards',
            title: '端口转发 (TCP/UDP)',
            render: (_, r) =>
              r.forwards.length === 0 ? (
                <span className="text-xs" style={{ color: '#c2cbd8' }}>—</span>
              ) : (
                <div className="flex flex-col gap-0.5">
                  {r.forwards.map((f, i) => (
                    <span key={i} className="kbd-mono text-xs" style={{ color: '#5b6a80' }}>
                      {r.serverAddr}:{f.remotePort} ⇒ {f.localIp}:{f.localPort}
                      {f.protocol && f.protocol !== 'TCP' ? ` (${f.protocol})` : ''}
                    </span>
                  ))}
                </div>
              ),
          },
          {
            key: 'createdAt',
            title: '创建时间',
            width: 150,
            render: (_, r) => (
              <Tooltip title={r.createdBy ? `创建人 ${r.createdBy}` : undefined}>
                <span className="whitespace-nowrap text-xs" style={{ color: '#5b6a80' }}>
                  {datetime(r.createdAt)}
                </span>
              </Tooltip>
            ),
          },
          {
            key: 'actions',
            title: '操作',
            width: 80,
            render: (_, r) => (
              <Button
                size="small"
                type="link"
                danger
                icon={<DeleteOutlined />}
                loading={deleting === r.id}
                style={{ paddingLeft: 0 }}
                onClick={() => remove(r)}
              >
                删除
              </Button>
            ),
          },
        ]}
      />

      <Modal
        title="新建隧道"
        width={720}
        open={createOpen}
        okText="创建"
        cancelText="取消"
        confirmLoading={submitting}
        onOk={() => void submit()}
        onCancel={() => setCreateOpen(false)}
      >
        <Form form={form} layout="vertical" initialValues={{ namespace: 'default', serverPort: 1270, webs: [], forwards: [] }}>
          <div className="grid grid-cols-2 gap-x-4">
            <Form.Item name="name" label="隧道名称" rules={[{ required: true, message: '请填写隧道名称' }]}>
              <Input placeholder="例如 门店后台穿透" maxLength={64} />
            </Form.Item>
            <Form.Item name="namespace" label="命名空间" rules={[{ required: true, message: '请填写命名空间' }]}>
              <Input placeholder="default" />
            </Form.Item>
          </div>

          <Divider titlePlacement="left" plain style={{ margin: '4px 0 12px' }}>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>FastTunnel 服务端</Typography.Text>
          </Divider>
          <div className="grid grid-cols-2 gap-x-4">
            <Form.Item name="serverAddr" label="服务端地址" rules={[{ required: true, message: '请填写服务端地址' }]}>
              <Input placeholder="suidao.example.com" />
            </Form.Item>
            <Form.Item name="serverPort" label="服务端端口" rules={[{ required: true, message: '请填写端口' }]}>
              <InputNumber min={1} max={65535} className="w-full" placeholder="1270" />
            </Form.Item>
          </div>
          <Form.Item name="token" label="令牌 Token" extra="服务端未开启校验时留空">
            <Input placeholder="选填" />
          </Form.Item>
          <Form.Item name="image" label="客户端镜像" extra="fasttunnel-client 镜像，需集群可拉取">
            <Input placeholder="springhgui/fasttunnel-client:latest" />
          </Form.Item>

          <Divider titlePlacement="left" plain style={{ margin: '4px 0 12px' }}>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>Web 穿透 (HTTP)</Typography.Text>
          </Divider>
          <Form.List name="webs">
            {(fields, { add, remove }) => (
              <div className="flex flex-col gap-2">
                {fields.map((field) => (
                  <Space key={field.key} align="baseline" className="!flex-wrap">
                    <Form.Item {...field} name={[field.name, 'subDomain']} rules={[{ required: true, message: '子域名' }]} className="!mb-0">
                      <Input placeholder="子域名 subDomain" style={{ width: 150 }} />
                    </Form.Item>
                    <Form.Item {...field} name={[field.name, 'localIp']} rules={[{ required: true, message: '内网 IP' }]} className="!mb-0">
                      <Input placeholder="内网 IP" style={{ width: 140 }} />
                    </Form.Item>
                    <Form.Item {...field} name={[field.name, 'localPort']} rules={[{ required: true, message: '端口' }]} className="!mb-0">
                      <InputNumber min={1} max={65535} placeholder="端口" style={{ width: 100 }} />
                    </Form.Item>
                    <MinusCircleOutlined onClick={() => remove(field.name)} />
                  </Space>
                ))}
                <Button type="dashed" icon={<PlusOutlined />} onClick={() => add({ subDomain: '', localIp: '', localPort: 80 })}>
                  添加 Web 穿透
                </Button>
              </div>
            )}
          </Form.List>

          <Divider titlePlacement="left" plain style={{ margin: '16px 0 12px' }}>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>端口转发 (TCP/UDP)</Typography.Text>
          </Divider>
          <Form.List name="forwards">
            {(fields, { add, remove }) => (
              <div className="flex flex-col gap-2">
                {fields.map((field) => (
                  <Space key={field.key} align="baseline" className="!flex-wrap">
                    <Form.Item {...field} name={[field.name, 'remotePort']} rules={[{ required: true, message: '远程端口' }]} className="!mb-0">
                      <InputNumber min={1} max={65535} placeholder="远程端口" style={{ width: 110 }} />
                    </Form.Item>
                    <Form.Item {...field} name={[field.name, 'localIp']} rules={[{ required: true, message: '内网 IP' }]} className="!mb-0">
                      <Input placeholder="内网 IP" style={{ width: 140 }} />
                    </Form.Item>
                    <Form.Item {...field} name={[field.name, 'localPort']} rules={[{ required: true, message: '端口' }]} className="!mb-0">
                      <InputNumber min={1} max={65535} placeholder="本地端口" style={{ width: 100 }} />
                    </Form.Item>
                    <Form.Item {...field} name={[field.name, 'protocol']} className="!mb-0">
                      <Select
                        style={{ width: 90 }}
                        options={[
                          { label: 'TCP', value: 'TCP' },
                          { label: 'UDP', value: 'UDP' },
                        ]}
                      />
                    </Form.Item>
                    <MinusCircleOutlined onClick={() => remove(field.name)} />
                  </Space>
                ))}
                <Button
                  type="dashed"
                  icon={<PlusOutlined />}
                  onClick={() => add({ remotePort: undefined, localIp: '', localPort: undefined, protocol: 'TCP' })}
                >
                  添加端口转发
                </Button>
              </div>
            )}
          </Form.List>
        </Form>
      </Modal>
    </PageShell>
  )
}
