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
  /** kubesphere.io/alias-name 注解，空串表示删除 */
  alias: string
  /** kubesphere.io/description 注解，空串表示删除 */
  description: string
}

interface Props {
  open: boolean
  onClose: () => void
  name: string
  namespace: string
  busy?: boolean
  /** binaryData 已有的键：与 data 共用键空间，导入文件时避让 */
  binaryKeys?: string[]
  initial: { items: LabelRowIn[]; LabelRows: LabelRowIn[]; Alias?: string; Description?: string }
  onSubmit: (values: ConfigMapEditValues) => void
}

/** 配置字典编辑：数据项 + 别名 + 标签 + 描述，提交后由调用方整体替换回原对象 */
export function EditConfigMapModal({ open, onClose, name, namespace, busy, binaryKeys, initial, onSubmit }: Props) {
  const { message } = App.useApp()
  const [form] = Form.useForm<{ items: LabelRowIn[]; LabelRows: LabelRowIn[]; Alias?: string; Description?: string }>()

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
    const data = dataFromRows(values.items)
    // binaryData 原样保留，同名的数据项会被 API 拒绝，先拦下
    const clash = Object.keys(data).filter((k) => binaryKeys?.includes(k))
    if (clash.length) {
      message.error(`数据项与二进制数据重名：${clash.join('、')}`)
      return
    }
    onSubmit({
      data,
      labels: labelsFromRows(values.LabelRows) ?? {},
      alias: values.Alias?.trim() ?? '',
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

        <DataItemsField minRows={0} usedKeys={binaryKeys} />

        <Form.Item label="别名" name="Alias">
          <Input maxLength={63} placeholder="请输入别名（可选）" />
        </Form.Item>

        <LabelRowsField />
        <DescriptionField />
      </Form>
    </KsCreateModal>
  )
}

export default EditConfigMapModal
