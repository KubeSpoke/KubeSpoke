import { App, Form, Input } from 'antd'
import { useEffect, useState } from 'react'
import KsCreateModal from '../../components/KsCreateModal'
import { DescriptionField, LabelRowsField } from '../../components/LabelRowsField'
import { DataItemsField } from './DataItemsField'
import { clusterApi } from '../../api/cluster'
import { buildConfigMapPayload } from '../../api/payloads'
import type { ConfigMapFormValues as FormValues } from '../../api/payloads'
import { YamlPreview } from '../../components/YamlPreview'

interface Props {
  open: boolean
  onClose: () => void
  cluster: string
  namespace: string
  onCreated: () => void
}

/** DNS-1123 label：ConfigMap 名称的硬性约束 */
const NAME_PATTERN = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/

export function CreateConfigMapModal({ open, onClose, cluster, namespace, onCreated }: Props) {
  const { message } = App.useApp()
  const [form] = Form.useForm<FormValues>()
  const [busy, setBusy] = useState(false)

  const watched = Form.useWatch([], form) as FormValues | undefined
  const preview = buildConfigMapPayload(watched ?? {}, { cluster, namespace })

  // 每次打开重置为「一行空数据项」，避免上次的残留
  useEffect(() => {
    if (open) form.resetFields()
  }, [open, form])

  const close = () => {
    form.resetFields()
    onClose()
  }

  const submit = async () => {
    const values = await form.validateFields().catch(() => null)
    if (!values) return
    const payload = buildConfigMapPayload(values, { cluster, namespace })
    if (Object.keys(payload.ConfigMap.data).length === 0) {
      message.error('请至少填写一个数据项（键不能为空）')
      return
    }
    setBusy(true)
    try {
      await clusterApi.createConfigMap(payload)
      message.success(`ConfigMap ${values.name} 已创建`)
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
      title="创建配置字典"
      onCancel={close}
      onOk={submit}
      okText="创建"
      okButtonProps={{ loading: busy }}
    >
      <Form form={form} layout="vertical" initialValues={{ items: [{ key: '', value: '' }] }}>
        <Form.Item
          name="name"
          label="名称"
          rules={[
            { required: true, message: '必填' },
            { pattern: NAME_PATTERN, message: '仅允许小写字母、数字和短横线，且以字母数字开头结尾' },
          ]}
        >
          <Input placeholder="app-config" />
        </Form.Item>

        <Form.Item label="命名空间">
          <Input disabled value={namespace} />
        </Form.Item>

        <DataItemsField />

        <DescriptionField />
        <LabelRowsField />
      </Form>

      <YamlPreview value={preview} />
    </KsCreateModal>
  )
}
