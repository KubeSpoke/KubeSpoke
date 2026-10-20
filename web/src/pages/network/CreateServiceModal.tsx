import { App, Form, Input, InputNumber, Select, Typography } from 'antd'
import { useState } from 'react'
import KsCreateModal from '../../components/KsCreateModal'
import { DescriptionField, LabelRowsField } from '../../components/LabelRowsField'
import { clusterApi } from '../../api/cluster'
import { buildServicePayload } from '../../api/payloads'
import type { ServiceFormValues } from '../../api/payloads'
import { YamlPreview } from '../../components/YamlPreview'

interface Props {
  open: boolean
  onClose: () => void
  cluster: string
  namespace: string
  onCreated: () => void
}

/** DNS-1123 label：小写字母数字，首尾必须是字母或数字 */
const DNS1123 = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/

export default function CreateServiceModal({ open, onClose, cluster, namespace, onCreated }: Props) {
  const { message } = App.useApp()
  const [form] = Form.useForm<ServiceFormValues>()
  const [busy, setBusy] = useState(false)
  const watched = Form.useWatch([], form) as ServiceFormValues | undefined
  const preview = buildServicePayload(watched ?? {}, { cluster, namespace })

  const close = () => {
    form.resetFields()
    onClose()
  }

  const submit = async () => {
    let values: ServiceFormValues
    try {
      values = await form.validateFields()
    } catch {
      return // 校验失败由表单项自己提示
    }
    setBusy(true)
    try {
      await clusterApi.createService(buildServicePayload(values, { cluster, namespace }))
      message.success(`Service 已创建：${values.Name}`)
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
      title="创建服务"
      onCancel={close}
      onOk={submit}
      okText="创建"
      okButtonProps={{ loading: busy }}
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={{ Type: 'ClusterIP', Port: 80 }}
        onValuesChange={(changed, all) => {
          if ('Name' in changed && !all.AppName) form.setFieldValue('AppName', changed.Name)
        }}
      >
        <Form.Item
          name="Name"
          label="名称"
          rules={[
            { required: true, message: '必填' },
            { pattern: DNS1123, message: '仅小写字母、数字和连字符，且不能以连字符开头或结尾' },
          ]}
        >
          <Input placeholder="my-service" />
        </Form.Item>

        <Form.Item
          name="AppName"
          label="关联应用名"
          tooltip="决定 Service 选中哪些 Pod"
          rules={[{ required: true, message: '必填' }]}
          extra="会作为 app=<应用名> 同时写入 Service 的 label 与 selector，必须等于目标 Deployment 的名称才能选中它的 Pod。"
        >
          <Input placeholder="通常与上方名称 / Deployment 名一致" />
        </Form.Item>

        <Form.Item name="Type" label="类型" rules={[{ required: true, message: '必选' }]}>
          <Select
            options={[
              { value: 'ClusterIP', label: 'ClusterIP' },
              { value: 'NodePort', label: 'NodePort' },
            ]}
          />
        </Form.Item>

        <Form.Item
          name="Port"
          label="端口"
          rules={[{ required: true, message: '必填' }]}
          extra="服务端不给 targetPort，Kubernetes 会按 port 同值转发，所以这里要填容器实际监听的端口。"
        >
          <InputNumber min={1} max={65535} style={{ width: 160 }} />
        </Form.Item>

        <DescriptionField />
        <LabelRowsField />

        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {cluster} / {namespace}
        </Typography.Text>
      </Form>

      <YamlPreview value={preview} />
    </KsCreateModal>
  )
}
