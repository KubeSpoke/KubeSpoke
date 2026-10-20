import { App, Button, Card, Col, Flex, Form, Input, InputNumber, Radio, Row, Select, Typography } from 'antd'
import { MinusCircleOutlined, PlusOutlined } from '@ant-design/icons'
import { useMemo, useState } from 'react'
import type { FormInstance } from 'antd'
import KsCreateModal from '../../components/KsCreateModal'
import { clusterApi } from '../../api/cluster'
import { buildDeploymentPayload, deploymentVolumeConflict } from '../../api/payloads'
import type { ContainerForm, DeploymentFormValues as FormValues, MountSource } from '../../api/payloads'
import { useResource } from '../../hooks/useResource'
import { YamlPreview } from '../../components/YamlPreview'

const DNS_NAME_RE = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?(\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*$/

type Options = { label: string; value: string }[]

const newContainer = (): ContainerForm => ({
  ContainerName: 'main',
  Image: '',
  ContainerPort: 80,
  Env: [],
  envFromCms: [],
  envFromSecrets: [],
  Mounts: [],
})

interface Props {
  open: boolean
  onClose: () => void
  cluster: string
  namespace: string
  onCreated: () => void
}

const STEPS = ['基本信息', '容器组设置', '存储设置', '高级设置']

export default function CreateDeploymentModal({ open, onClose, cluster, namespace, onCreated }: Props) {
  const { message } = App.useApp()
  const [form] = Form.useForm<FormValues>()
  const [busy, setBusy] = useState(false)
  const [step, setStep] = useState(0)
  const [maxStep, setMaxStep] = useState(0)
  const [tick, setTick] = useState(0)

  // 引用数据只在弹窗打开时拉取
  const configMaps = useResource(() => (open ? clusterApi.configMaps(cluster, namespace) : Promise.resolve([])), [open, cluster, namespace])
  const secrets = useResource(() => (open ? clusterApi.secrets(cluster, namespace) : Promise.resolve([])), [open, cluster, namespace])
  const pvcs = useResource(() => (open ? clusterApi.pvcs(cluster, namespace) : Promise.resolve([])), [open, cluster, namespace])

  const preview = useMemo(
    // 读全量 store（含未挂载字段），与 submit 的 getFieldsValue(true) 一致，避免切步后预览丢失前序步骤的值
    () => buildDeploymentPayload(form.getFieldsValue(true) as FormValues, { cluster, namespace }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tick, open, cluster, namespace],
  )

  const cmOptions: Options = (configMaps.data ?? []).map((cm) => ({ label: cm.metadata?.name ?? '', value: cm.metadata?.name ?? '' }))
  const cmKeyMap = useMemo(
    () => Object.fromEntries((configMaps.data ?? []).map((cm) => [cm.metadata?.name ?? '', Object.keys(cm.data ?? {})])),
    [configMaps.data],
  )
  const secretOptions: Options = (secrets.data ?? []).map((s) => ({ label: s.name, value: s.name }))
  const pullOptions: Options = (secrets.data ?? [])
    .filter((s) => s.type === 'kubernetes.io/dockerconfigjson')
    .map((s) => ({ label: s.name, value: s.name }))
  const pvcOptions: Options = (pvcs.data ?? []).map((p) => ({ label: p.metadata?.name ?? '', value: p.metadata?.name ?? '' }))

  const reset = () => {
    form.resetFields()
    setStep(0)
    setMaxStep(0)
  }

  const validateStep = async (s: number) => {
    const containers: ContainerForm[] = form.getFieldValue('Containers') || []
    let fields: (string | number)[][] = []
    if (s === 0) fields = [['Name'], ['Replicas']]
    else if (s === 1)
      fields = containers.flatMap((_, i) => [
        ['Containers', i, 'ContainerName'],
        ['Containers', i, 'Image'],
        ['Containers', i, 'ContainerPort'],
      ])
    // 步骤 2/3 无强制必填
    if (!fields.length) return true
    try {
      await form.validateFields(fields)
      return true
    } catch (e) {
      const first = (e as { errorFields?: { errors?: string[] }[] }).errorFields?.[0]?.errors?.[0]
      message.error(first ?? '请先完善当前步骤的必填项')
      return false
    }
  }

  const next = async () => {
    if (!(await validateStep(step))) return
    const target = Math.min(step + 1, STEPS.length - 1)
    setMaxStep((m) => Math.max(m, target))
    setStep(target)
  }
  const prev = () => setStep((s) => Math.max(0, s - 1))
  const goto = (i: number) => {
    if (i <= maxStep) setStep(i)
  }

  const submit = async () => {
    // 逐级校验，避免跳步绕过必填
    for (let s = 0; s <= 1; s++) if (!(await validateStep(s))) { setStep(s); return }
    const values = form.getFieldsValue(true) as FormValues
    setBusy(true)
    try {
      await clusterApi.createDeployment(buildDeploymentPayload(values, { cluster, namespace }))
      message.success('Deployment 已创建：' + values.Name)
      onCreated()
      onClose()
      reset()
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <KsCreateModal
      open={open}
      title="创建部署"
      okText="创建"
      steps={STEPS}
      current={step}
      onNext={next}
      onPrev={prev}
      onStepClick={goto}
      okButtonProps={{ loading: busy, disabled: busy }}
      onOk={submit}
      onCancel={() => {
        reset()
        onClose()
      }}
    >
      <Form
        form={form}
        layout="vertical"
        preserve
        initialValues={{ Replicas: 1, Containers: [newContainer()] }}
        onValuesChange={() => setTick((t) => t + 1)}
      >
        {step === 0 && (
          <>
            <Row gutter={12}>
              <Col span={12}>
                <Form.Item
                  label="名称"
                  name="Name"
                  rules={[
                    { required: true, message: '必填' },
                    { pattern: DNS_NAME_RE, message: '仅限小写字母、数字、- 和 .，且以字母或数字开头结尾' },
                  ]}
                >
                  <Input placeholder="my-app" />
                </Form.Item>
              </Col>
              <Col span={6}>
                <Form.Item label="副本数" name="Replicas" rules={[{ required: true, message: '必填' }]}>
                  <InputNumber min={0} className="w-full" />
                </Form.Item>
              </Col>
              <Col span={6}>
                <Form.Item label="命名空间">
                  <Input value={namespace} disabled />
                </Form.Item>
              </Col>
            </Row>
            <Form.Item label="描述" name="Description">
              <Input.TextArea rows={2} placeholder="为部署添加描述（可选）" />
            </Form.Item>
          </>
        )}

        {step === 1 && (
          <Form.List name="Containers">
            {(fields, { add, remove }) => (
              <Flex vertical gap={12}>
                {fields.map((f) => (
                  <Card
                    key={f.key}
                    size="small"
                    title={`容器 ${f.name + 1}`}
                    extra={
                      fields.length > 1 && (
                        <Button type="link" size="small" danger onClick={() => remove(f.name)}>
                          移除
                        </Button>
                      )
                    }
                  >
                    <ContainerBlock
                      form={form}
                      index={f.name}
                      section="spec"
                      cmOptions={cmOptions}
                      cmKeyMap={cmKeyMap}
                      secretOptions={secretOptions}
                      pvcOptions={pvcOptions}
                      refLoading={configMaps.loading || secrets.loading || pvcs.loading}
                    />
                  </Card>
                ))}
                <Button type="dashed" block icon={<PlusOutlined />} onClick={() => add({ ...newContainer(), ContainerName: `container-${fields.length + 1}` })}>
                  添加容器
                </Button>
              </Flex>
            )}
          </Form.List>
        )}

        {step === 2 && (
          <Form.List name="Containers">
            {(fields) => (
              <Flex vertical gap={12}>
                {fields.map((f) => (
                  <Card key={f.key} size="small" title={`容器 ${f.name + 1} · 卷挂载`}>
                    <ContainerBlock
                      form={form}
                      index={f.name}
                      section="mounts"
                      cmOptions={cmOptions}
                      cmKeyMap={cmKeyMap}
                      secretOptions={secretOptions}
                      pvcOptions={pvcOptions}
                      refLoading={configMaps.loading || secrets.loading || pvcs.loading}
                    />
                  </Card>
                ))}
              </Flex>
            )}
          </Form.List>
        )}

        {step === 3 && (
          <>
            <Form.Item label="镜像拉取凭据" name="ImagePullSecrets" tooltip="dockerconfigjson 类型的 Secret，拉私有镜像时选择">
              <Select mode="multiple" allowClear placeholder="可选" options={pullOptions} loading={secrets.loading} />
            </Form.Item>
            <Typography.Text type="secondary" className="mb-2 block">
              标签
            </Typography.Text>
            <Form.List name="LabelRows">
              {(rows, { add, remove }) => (
                <Flex vertical gap={4}>
                  {rows.map((r) => (
                    <Flex key={r.key} gap={8} align="flex-start" wrap={false}>
                      <Form.Item name={[r.name, 'key']} noStyle>
                        <Input style={{ flex: '1 1 160px', minWidth: 120 }} placeholder="标签名，如 tier" />
                      </Form.Item>
                      <Form.Item name={[r.name, 'value']} noStyle>
                        <Input style={{ flex: '1 1 200px', minWidth: 120 }} placeholder="值，如 frontend" />
                      </Form.Item>
                      <Button type="text" danger icon={<MinusCircleOutlined />} style={{ flex: 'none' }} onClick={() => remove(r.name)} />
                    </Flex>
                  ))}
                  <div>
                    <Button size="small" icon={<PlusOutlined />} onClick={() => add({ key: '', value: '' })}>
                      添加标签
                    </Button>
                  </div>
                </Flex>
              )}
            </Form.List>
            <YamlPreview value={preview} maxHeight={300} />
          </>
        )}
      </Form>
    </KsCreateModal>
  )
}

interface BlockProps {
  form: FormInstance<FormValues>
  index: number
  /** spec = 名称/镜像/端口/环境变量；mounts = 卷挂载；all = 全部 */
  section?: 'spec' | 'mounts' | 'all'
  cmOptions: Options
  cmKeyMap: Record<string, string[]>
  secretOptions: Options
  pvcOptions: Options
  refLoading: boolean
}

function ContainerBlock({ form, index, section = 'all', cmOptions, cmKeyMap, secretOptions, pvcOptions, refLoading }: BlockProps) {
  const showSpec = section === 'spec' || section === 'all'
  const showMounts = section === 'mounts' || section === 'all'
  return (
    <>
      {showSpec && (
        <>
          <Row gutter={12}>
            <Col span={8}>
              <Form.Item label="容器名" name={[index, 'ContainerName']} rules={[{ required: true, message: '必填' }]}>
                <Input placeholder="main" />
              </Form.Item>
            </Col>
            <Col span={16}>
              <Form.Item label="镜像" name={[index, 'Image']} rules={[{ required: true, message: '必填' }]}>
                <Input placeholder="registry.example.com/team/app:tag" />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={12}>
            <Col span={8}>
              <Form.Item label="容器端口" name={[index, 'ContainerPort']} rules={[{ required: true, message: '必填' }]}>
                <InputNumber min={1} max={65535} className="w-full" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item label="主机端口" name={[index, 'HostPort']} tooltip="极少用到：只有需要从节点端口直接暴露该容器时才填">
                <InputNumber min={1} max={65535} className="w-full" placeholder="一般留空" />
              </Form.Item>
            </Col>
          </Row>

          <Typography.Text type="secondary" className="mb-2 block">
            环境变量
          </Typography.Text>
          <Form.List name={[index, 'Env']}>
            {(envFields, { add, remove }) => (
              <Flex vertical gap={4}>
                {envFields.map((ef) => (
                  <EnvRow key={ef.key} form={form} ci={index} name={ef.name} onRemove={() => remove(ef.name)} cmOptions={cmOptions} cmKeyMap={cmKeyMap} refLoading={refLoading} />
                ))}
                <div>
                  <Button size="small" icon={<PlusOutlined />} onClick={() => add({ kind: 'literal' })}>
                    添加变量
                  </Button>
                </div>
              </Flex>
            )}
          </Form.List>

          <Typography.Text type="secondary" className="mb-2 block mt-3">
            环境变量整包
          </Typography.Text>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item label="引用 ConfigMap" name={[index, 'envFromCms']}>
                <Select mode="multiple" allowClear placeholder="整个 ConfigMap 注入" options={cmOptions} loading={refLoading} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="引用 Secret" name={[index, 'envFromSecrets']}>
                <Select mode="multiple" allowClear placeholder="整个 Secret 注入" options={secretOptions} loading={refLoading} />
              </Form.Item>
            </Col>
          </Row>
        </>
      )}

      {showMounts && (
        <>
          <Typography.Text type="secondary" className="mb-2 block">
            卷挂载
          </Typography.Text>
          <Form.List name={[index, 'Mounts']}>
            {(mountFields, { add, remove }) => (
              <Flex vertical gap={4}>
                {mountFields.map((mf) => (
                  <MountRow key={mf.key} form={form} ci={index} name={mf.name} onRemove={() => remove(mf.name)} pvcOptions={pvcOptions} refLoading={refLoading} />
                ))}
                <div>
                  <Button size="small" icon={<PlusOutlined />} onClick={() => add({ source: 'host' })}>
                    添加挂载
                  </Button>
                </div>
              </Flex>
            )}
          </Form.List>
          {!showSpec && (
            <Typography.Text type="secondary" className="!mt-2 block text-xs">
              为容器挂载 host 目录或 PVC 卷。
            </Typography.Text>
          )}
        </>
      )}
    </>
  )
}

interface EnvRowProps {
  form: FormInstance<FormValues>
  ci: number
  name: number
  onRemove: () => void
  cmOptions: Options
  cmKeyMap: Record<string, string[]>
  refLoading: boolean
}

function EnvRow({ form, ci, name, onRemove, cmOptions, cmKeyMap, refLoading }: EnvRowProps) {
  const kind = Form.useWatch(['Containers', ci, 'Env', name, 'kind'], form) ?? 'literal'
  const cmName = Form.useWatch(['Containers', ci, 'Env', name, 'cmName'], form) as string | undefined
  const keyOptions: Options = (cmKeyMap[cmName ?? ''] ?? []).map((k) => ({ label: k, value: k }))
  return (
    <Flex gap={8} align="flex-start" wrap={false}>
      <Form.Item name={[name, 'kind']} noStyle>
        <Select
          style={{ width: 120, flex: 'none' }}
          options={[
            { label: '字面量', value: 'literal' },
            { label: 'ConfigMap 键', value: 'cm' },
          ]}
        />
      </Form.Item>
      <Form.Item name={[name, 'name']} noStyle rules={[{ required: true, message: '变量名必填' }]}>
        <Input style={{ flex: '1 1 150px', minWidth: 110 }} placeholder="变量名" />
      </Form.Item>
      {kind === 'cm' ? (
        <>
          <Form.Item name={[name, 'cmName']} noStyle rules={[{ required: true, message: '请选择 ConfigMap' }]}>
            <Select
              showSearch
              allowClear
              style={{ width: 170, flex: 'none' }}
              placeholder="ConfigMap"
              options={cmOptions}
              loading={refLoading}
              onChange={() => form.setFieldValue(['Containers', ci, 'Env', name, 'cmKey'], undefined)}
            />
          </Form.Item>
          <Form.Item name={[name, 'cmKey']} noStyle rules={[{ required: true, message: '请选择要注入的键' }]}>
            <Select showSearch allowClear style={{ width: 150, flex: 'none' }} placeholder="键" options={keyOptions} disabled={!cmName} />
          </Form.Item>
        </>
      ) : (
        <Form.Item name={[name, 'value']} noStyle>
          <Input style={{ flex: '2 1 240px', minWidth: 120 }} placeholder="值" />
        </Form.Item>
      )}
      <Button type="text" danger icon={<MinusCircleOutlined />} style={{ flex: 'none' }} onClick={onRemove} />
    </Flex>
  )
}

interface MountRowProps {
  form: FormInstance<FormValues>
  ci: number
  name: number
  onRemove: () => void
  pvcOptions: Options
  refLoading: boolean
}

function MountRow({ form, ci, name, onRemove, pvcOptions, refLoading }: MountRowProps) {
  const source = Form.useWatch(['Containers', ci, 'Mounts', name, 'source'], form) as MountSource | undefined
  return (
    <Flex gap={8} align="flex-start" wrap={false}>
      <Form.Item
        name={[name, 'name']}
        noStyle
        rules={[
          { required: true, message: '卷名必填' },
          {
            validator: async () => {
              const err = deploymentVolumeConflict(form.getFieldValue('Containers'))
              if (err) throw new Error(err)
            },
          },
        ]}
      >
        <Input style={{ flex: '1 1 130px', minWidth: 96 }} placeholder="卷名" />
      </Form.Item>
      <Form.Item name={[name, 'mountPath']} noStyle rules={[{ required: true, message: '挂载路径必填' }]}>
        <Input style={{ flex: '1 1 150px', minWidth: 110 }} placeholder="如 /data" />
      </Form.Item>
      <Form.Item name={[name, 'source']} noStyle initialValue="host">
        <Radio.Group
          optionType="button"
          style={{ flex: 'none' }}
          options={[
            { label: 'host 目录', value: 'host' },
            { label: 'PVC', value: 'pvc' },
          ]}
          onChange={() => {
            form.setFieldValue(['Containers', ci, 'Mounts', name, 'hostPath'], undefined)
            form.setFieldValue(['Containers', ci, 'Mounts', name, 'claimName'], undefined)
          }}
        />
      </Form.Item>
      {source === 'pvc' ? (
        <Form.Item name={[name, 'claimName']} noStyle rules={[{ required: true, message: '请选择 PVC' }]}>
          <Select showSearch style={{ flex: '1 1 200px', minWidth: 140 }} placeholder="PVC" options={pvcOptions} loading={refLoading} />
        </Form.Item>
      ) : (
        <Form.Item name={[name, 'hostPath']} noStyle rules={[{ required: true, message: '主机路径必填' }]}>
          <Input style={{ flex: '1 1 200px', minWidth: 140 }} placeholder="主机路径，如 /data/app" />
        </Form.Item>
      )}
      <Button type="text" danger icon={<MinusCircleOutlined />} style={{ flex: 'none' }} onClick={onRemove} />
    </Flex>
  )
}
