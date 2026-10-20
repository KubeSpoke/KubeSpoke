import { App, Form, Input, InputNumber, Select, Space, Typography } from 'antd'
import { useState } from 'react'
import KsCreateModal from '../../components/KsCreateModal'
import { DescriptionField, LabelRowsField } from '../../components/LabelRowsField'
import { clusterApi } from '../../api/cluster'
import { buildPvcPayload } from '../../api/payloads'
import type { PvcFormValues as FormValues } from '../../api/payloads'
import { useResource } from '../../hooks/useResource'
import { YamlPreview } from '../../components/YamlPreview'

interface Props {
  open: boolean
  onClose: () => void
  cluster: string
  namespace: string
  onCreated: () => void
}

const NAME_RE = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/
const STORAGE_RE = /^[0-9]+(\.[0-9]+)?(Ki|Mi|Gi|Ti|Pi)$/

const ACCESS_MODES = ['ReadWriteOnce', 'ReadWriteMany', 'ReadOnlyMany']
const UNITS = ['Ki', 'Mi', 'Gi', 'Ti', 'Pi']

export default function CreatePvcModal({ open, onClose, cluster, namespace, onCreated }: Props) {
  const { message } = App.useApp()
  const [form] = Form.useForm<FormValues>()
  const [busy, setBusy] = useState(false)
  const watched = Form.useWatch([], form)

  // 弹窗没打开就不去拉集群级的 StorageClass 列表
  const classes = useResource(
    () => (open ? clusterApi.storageClasses(cluster) : Promise.resolve([])),
    [open, cluster],
  )

  const submit = async () => {
    let values: FormValues
    try {
      values = await form.validateFields()
    } catch {
      return // 缺字段由 Form 自己标红
    }
    setBusy(true)
    try {
      await clusterApi.createPersistentVolumeClaim(buildPvcPayload(values, { cluster, namespace }))
      message.success(`PVC 已创建：${values.name?.trim()}`)
      form.resetFields()
      onClose()
      onCreated()
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const cancel = () => {
    if (busy) return
    form.resetFields()
    onClose()
  }

  return (
    <KsCreateModal
      open={open}
      title="创建持久卷声明"
      okText="创建"
      okButtonProps={{ loading: busy }}
      onOk={submit}
      onCancel={cancel}
    >
      <Form
        form={form}
        layout="vertical"
        className="mt-3"
        disabled={busy}
        initialValues={{ capacity: 1, unit: 'Gi', accessModes: ['ReadWriteMany'] }}
      >
        <Form.Item
          label="名称"
          name="name"
          rules={[
            { required: true, message: '必填' },
            { pattern: NAME_RE, message: '小写字母、数字或 -，不能以 - 开头结尾' },
          ]}
        >
          <Input placeholder="my-nfs-data" autoFocus />
        </Form.Item>

        <Form.Item label="命名空间" extra="写入清单的 metadata.namespace，与当前命名空间一致">
          <Input disabled value={namespace} />
        </Form.Item>

        <Form.Item label="容量" required>
          <Space.Compact block>
            <Form.Item
              name="capacity"
              noStyle
              dependencies={['unit']}
              rules={[
                { required: true, message: '必填' },
                ({ getFieldValue }) => ({
                  validator: (_, value) =>
                    STORAGE_RE.test(`${value ?? ''}${getFieldValue('unit') ?? ''}`)
                      ? Promise.resolve()
                      : Promise.reject(new Error('形如 1Gi / 500Mi')),
                }),
              ]}
            >
              <InputNumber min={0} step={0.5} style={{ width: '100%' }} placeholder="1" />
            </Form.Item>
            <Form.Item name="unit" noStyle>
              <Select style={{ width: 96 }} options={UNITS.map((u) => ({ value: u, label: u }))} />
            </Form.Item>
          </Space.Compact>
        </Form.Item>

        <Form.Item label="访问模式" name="accessModes" rules={[{ required: true, message: '至少选一个' }]}>
          <Select mode="multiple" placeholder="选择访问模式" options={ACCESS_MODES.map((m) => ({ value: m, label: m }))} />
        </Form.Item>

        <Form.Item
          label="StorageClass"
          name="storageClassName"
          extra={
            classes.error ? (
              <Typography.Text type="danger">{classes.error}</Typography.Text>
            ) : (
              '留空则由集群的默认 StorageClass 供应'
            )
          }
        >
          <Select
            allowClear
            loading={classes.loading}
            placeholder="选择 StorageClass"
            options={(classes.data ?? []).map((sc) => ({ value: sc.metadata?.name ?? '', label: sc.metadata?.name }))}
          />
        </Form.Item>

        <Form.Item label="绑定已有 PV" name="volumeName" extra="选填，填了就用指定 PV，不再动态供应">
          <Input placeholder="pv-nfs-001" />
        </Form.Item>

        <DescriptionField />
        <LabelRowsField />

        <YamlPreview value={buildPvcPayload(watched ?? {}, { cluster, namespace })} />
      </Form>
    </KsCreateModal>
  )
}
