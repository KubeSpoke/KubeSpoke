import { App, Form, Input } from 'antd'
import KsCreateModal from '../../components/KsCreateModal'
import { DescriptionField, LabelRowsField } from '../../components/LabelRowsField'
import { DataItemsField } from './DataItemsField'
import { dataFromRows, duplicateDataKeys, labelsFromRows } from '../../api/payloads'
import type { LabelRowIn } from '../../api/payloads'

export interface ConfigMapEditValues {
  /** 全量替换 ConfigMap 的 data */
  data: Record<string, string>
  /** 全量替换 metadata.labels */
  labels: Record<string, string>
  /** kubesphere.io/description 注解，空串表示删除 */
  description: string
}

interface Props {
  open: boolean
  onClose: () => void
  name: string
  namespace: string
  busy?: boolean
  initial: { items: LabelRowIn[]; LabelRows: LabelRowIn[]; Description?: string }
  onSubmit: (values: ConfigMapEditValues) => void
}

/** 配置字典编辑：数据项 + 标签 + 描述，提交后由调用方整体替换回原对象 */
export function EditConfigMapModal({ open, onClose, name, namespace, busy, initial, onSubmit }: Props) {
  const { message } = App.useApp()
  const [form] = Form.useForm<{ items: LabelRowIn[]; LabelRows: LabelRowIn[]; Description?: string }>()

  const close = () => {
    form.resetFields()
    onClose()
  }

  const submit = async () => {
    const values = await form.validateFields().catch(() => null)
    if (!values) return
    const dup = duplicateDataKeys(values.items)
    if (dup.length) {
      message.error(`数据项键重复：${dup.join('、')}`)
      return
    }
    onSubmit({
      data: dataFromRows(values.items),
      labels: labelsFromRows(values.LabelRows) ?? {},
      description: values.Description?.trim() ?? '',
    })
  }

  return (
    <KsCreateModal
      open={open}
      title={`编辑配置字典 · ${name}`}
      showYamlToggle={false}
      onCancel={close}
      onOk={submit}
      okText="确定"
      okButtonProps={{ loading: busy }}
    >
      <Form form={form} layout="vertical" initialValues={initial}>
        <Form.Item label="名称">
          <Input disabled value={name} />
        </Form.Item>

        <Form.Item label="命名空间">
          <Input disabled value={namespace} />
        </Form.Item>

        <DataItemsField minRows={0} />

        <LabelRowsField />
        <DescriptionField />
      </Form>
    </KsCreateModal>
  )
}

export default EditConfigMapModal
