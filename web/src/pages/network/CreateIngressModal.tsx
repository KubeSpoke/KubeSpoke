import {
  App,
  Button,
  Card,
  Flex,
  Form,
  Input,
  InputNumber,
  Select,
  Space,
  Switch,
  Typography,
} from 'antd'
import { useState } from 'react'
import KsCreateModal from '../../components/KsCreateModal'
import { DescriptionField, LabelRowsField } from '../../components/LabelRowsField'
import { clusterApi } from '../../api/cluster'
import { buildIngressPayload } from '../../api/payloads'
import type { IngressFormValues, PathRow } from '../../api/payloads'
import { YamlPreview } from '../../components/YamlPreview'
import { useResource } from '../../hooks/useResource'

interface Props {
  open: boolean
  onClose: () => void
  cluster: string
  namespace: string
  onCreated: () => void
}

const DNS1123 = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/

const PATH_TYPES = [
  { value: 'Prefix', label: 'Prefix（前缀）' },
  { value: 'Exact', label: 'Exact（精确）' },
  { value: 'ImplementationSpecific', label: 'ImplementationSpecific' },
] as const

const DEFAULT_PATH = { path: '/', pathType: 'Prefix', port: 80 } satisfies PathRow

export default function CreateIngressModal({ open, onClose, cluster, namespace, onCreated }: Props) {
  const { message } = App.useApp()
  const [form] = Form.useForm<IngressFormValues>()
  const [busy, setBusy] = useState(false)
  const [manualClass, setManualClass] = useState(false)
  const [useTls, setUseTls] = useState(false)

  // 参考数据只在弹窗打开后拉取
  const classes = useResource(() => (open ? clusterApi.ingressClasses(cluster) : Promise.resolve([])), [open, cluster])
  const services = useResource(() => (open ? clusterApi.services(cluster, namespace) : Promise.resolve([])), [
    open,
    cluster,
    namespace,
  ])
  const secrets = useResource(() => (open ? clusterApi.secrets(cluster, namespace) : Promise.resolve([])), [
    open,
    cluster,
    namespace,
  ])

  const watched = Form.useWatch([], form) as IngressFormValues | undefined
  const preview = buildIngressPayload(watched ?? {}, { cluster, namespace })

  const classOptions = (classes.data ?? [])
    .map((c) => c.metadata?.name)
    .filter((n): n is string => !!n)
    .map((n) => ({ value: n, label: n }))

  const serviceOptions = (services.data ?? []).map((s) => ({
    value: s.name,
    label: s.ports?.length ? `${s.name} :${s.ports.map((p) => p.port).join('/')}` : s.name,
  }))

  const tlsSecretOptions = (secrets.data ?? [])
    .filter((s) => s.type === 'kubernetes.io/tls')
    .map((s) => ({ value: s.name, label: s.name }))

  // TLS 域名候选取自规则里已填写的 host，同时允许手动输入
  const hostOptions = Array.from(
    new Set((watched?.Rules ?? []).map((r) => r.host?.trim()).filter((h): h is string => !!h)),
  ).map((h) => ({ value: h, label: h }))

  const close = () => {
    form.resetFields()
    setManualClass(false)
    setUseTls(false)
    onClose()
  }

  const submit = async () => {
    let values: IngressFormValues
    try {
      values = await form.validateFields()
    } catch {
      return
    }
    const payload = buildIngressPayload(values, { cluster, namespace })
    if (payload.Rules.length === 0) {
      message.error('请至少配置一条含后端服务的规则')
      return
    }
    setBusy(true)
    try {
      await clusterApi.createIngress(payload)
      message.success(`Ingress 已创建：${values.Name}`)
      onCreated()
      close()
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <KsCreateModal
      open={open}
      title="创建路由"
      onCancel={close}
      onOk={submit}
      okText="创建"
      okButtonProps={{ loading: busy }}
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={{ Rules: [{ paths: [DEFAULT_PATH] }] }}
      >
        <Flex gap={12} wrap>
          <Form.Item
            name="Name"
            label="名称"
            style={{ flex: 1, minWidth: 220 }}
            rules={[
              { required: true, message: '必填' },
              { pattern: DNS1123, message: '仅小写字母、数字和连字符，且不能以连字符开头或结尾' },
            ]}
          >
            <Input placeholder="my-ingress" />
          </Form.Item>

          <Form.Item label="命名空间" style={{ flex: 1, minWidth: 180 }}>
            <Input readOnly bordered={false} value={`${cluster} / ${namespace}`} />
          </Form.Item>
        </Flex>

        <Form.Item label="Ingress Class" extra="集群没有 IngressClass 对象时可切到手动输入；留空则用集群默认入口。">
          <Flex gap={8} align="center">
            {manualClass ? (
              <Form.Item name="IngressClassName" noStyle>
                <Input placeholder="如 nginx（手动输入）" style={{ width: 260 }} />
              </Form.Item>
            ) : (
              <Form.Item name="IngressClassName" noStyle>
                <Select
                  showSearch
                  allowClear
                  placeholder="选择 IngressClass"
                  style={{ width: 260 }}
                  loading={classes.loading}
                  notFoundContent={classes.loading ? '加载中' : '无（可切换手动输入）'}
                  options={classOptions}
                />
              </Form.Item>
            )}
            <Switch
              size="small"
              checked={manualClass}
              onChange={(v) => {
                setManualClass(v)
                form.setFieldValue('IngressClassName', undefined)
              }}
            />
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              手动输入
            </Typography.Text>
          </Flex>
        </Form.Item>

        <Typography.Text strong>转发规则</Typography.Text>
        <Form.List name="Rules">
          {(ruleFields, { add: addRule, remove: removeRule }) => (
            <Space orientation="vertical" size={12} className="mb-4 w-full">
              {ruleFields.map((rf) => (
                <Card
                  key={rf.key}
                  size="small"
                  extra={
                    ruleFields.length > 1 ? (
                      <Button type="link" danger size="small" onClick={() => removeRule(rf.name)}>
                        删除规则
                      </Button>
                    ) : undefined
                  }
                >
                  <Form.Item
                    name={[rf.name, 'host']}
                    label="域名"
                    extra="留空表示匹配所有域名（catch-all）。"
                    style={{ marginBottom: 8 }}
                  >
                    <Input placeholder="app.example.com" style={{ maxWidth: 320 }} />
                  </Form.Item>

                  <Form.List name={[rf.name, 'paths']}>
                    {(pathFields, { add: addPath, remove: removePath }) => (
                      <Space orientation="vertical" size={4} className="w-full">
                        {pathFields.map((pf) => (
                          <Flex key={pf.key} gap={8} align="flex-start" wrap={false}>
                            <Form.Item
                              name={[pf.name, 'path']}
                              label="路径"
                              style={{ marginBottom: 8, flex: '1 1 110px', minWidth: 88 }}
                            >
                              <Input placeholder="/" />
                            </Form.Item>
                            <Form.Item
                              name={[pf.name, 'pathType']}
                              label="匹配方式"
                              style={{ marginBottom: 8, flex: 'none', width: 150 }}
                            >
                              <Select options={PATH_TYPES.map((t) => ({ ...t }))} />
                            </Form.Item>
                            <Form.Item
                              name={[pf.name, 'service']}
                              label="后端服务"
                              style={{ marginBottom: 8, flex: '1 1 170px', minWidth: 130 }}
                            >
                              <Select
                                showSearch
                                placeholder="选择 Service"
                                loading={services.loading}
                                notFoundContent={services.loading ? '加载中' : '无'}
                                options={serviceOptions}
                              />
                            </Form.Item>
                            <Form.Item
                              name={[pf.name, 'port']}
                              label="端口"
                              style={{ marginBottom: 8, flex: 'none', width: 84 }}
                            >
                              <InputNumber min={1} max={65535} style={{ width: '100%' }} />
                            </Form.Item>
                            {pathFields.length > 1 && (
                              <Button
                                type="link"
                                danger
                                size="small"
                                style={{ marginTop: 30, flex: 'none' }}
                                onClick={() => removePath(pf.name)}
                              >
                                删除
                              </Button>
                            )}
                          </Flex>
                        ))}
                        <Button type="dashed" size="small" block onClick={() => addPath({ ...DEFAULT_PATH })}>
                          + 添加路径
                        </Button>
                      </Space>
                    )}
                  </Form.List>
                </Card>
              ))}
              <Button type="dashed" block onClick={() => addRule({ paths: [{ ...DEFAULT_PATH }] })}>
                + 添加规则
              </Button>
            </Space>
          )}
        </Form.List>

        <Flex align="center" gap={8} className="mb-2">
          <Typography.Text strong>TLS 证书</Typography.Text>
          <Switch
            size="small"
            checked={useTls}
            onChange={(v) => {
              setUseTls(v)
              form.setFieldValue('Tls', v ? [{ hosts: [] }] : undefined)
            }}
          />
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            添加证书
          </Typography.Text>
        </Flex>

        {useTls && (
          <Form.List name="Tls">
            {(tlsFields, { add, remove }) => (
              <Space orientation="vertical" size={8} className="mb-2 w-full">
                {tlsFields.map((tf) => (
                  <Flex key={tf.key} gap={8} align="flex-start" wrap={false}>
                    <Form.Item
                      name={[tf.name, 'hosts']}
                      label="域名"
                      style={{ marginBottom: 8, flex: '1 1 260px', minWidth: 160 }}
                    >
                      <Select
                        mode="tags"
                        placeholder="选择或输入域名"
                        tokenSeparators={[',', ' ']}
                        options={hostOptions}
                      />
                    </Form.Item>
                    <Form.Item
                      name={[tf.name, 'secretName']}
                      label="证书"
                      style={{ marginBottom: 8, flex: '1 1 220px', minWidth: 150 }}
                    >
                      <Select
                        showSearch
                        allowClear
                        placeholder="kubernetes.io/tls Secret"
                        loading={secrets.loading}
                        notFoundContent={secrets.loading ? '加载中' : '无 TLS Secret'}
                        options={tlsSecretOptions}
                      />
                    </Form.Item>
                    <Button
                      type="link"
                      danger
                      size="small"
                      style={{ marginTop: 30, flex: 'none' }}
                      onClick={() => remove(tf.name)}
                    >
                      删除
                    </Button>
                  </Flex>
                ))}
                <Button type="dashed" size="small" block onClick={() => add({ hosts: [], secretName: undefined })}>
                  + 添加证书条目
                </Button>
              </Space>
            )}
          </Form.List>
        )}

        <DescriptionField />
        <LabelRowsField />
      </Form>

      <YamlPreview value={preview} />
    </KsCreateModal>
  )
}
