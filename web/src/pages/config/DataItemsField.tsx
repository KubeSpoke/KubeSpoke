import { App, Button, Form, Input, Upload } from 'antd'
import { MinusOutlined, PlusOutlined, UploadOutlined } from '@ant-design/icons'
import { importDataFiles } from './importDataFiles'

interface Row {
  key: string
  value: string
}

/**
 * 配置字典「数据项」键/值成行编辑器，挂在任意 Form 下。
 * 字段值形状：{ key, value }[]，由 payloads.ts 的 dataFromRows 归并成 data。
 * usedKeys 是 data 之外的既有键（如 binaryData），导入文件时用于避让重名。
 */
export function DataItemsField({ name = 'items', minRows = 1, usedKeys = [] }: { name?: string; minRows?: number; usedKeys?: string[] }) {
  const { message } = App.useApp()
  const form = Form.useFormInstance()

  return (
    <Form.Item label="数据项" required>
      <Form.List name={name}>
        {(fields, { add, remove }) => {
          const importFiles = async (files: File[]) => {
            const rows: Row[] = []
            const errors: string[] = []
            const taken = new Set([
              ...usedKeys,
              ...((form.getFieldValue(name) as Row[] | undefined) ?? []).map((r) => r?.key?.trim()).filter(Boolean),
            ])
            for (const file of files) {
              const r = await importDataFiles(file, [...taken])
              if ('error' in r) {
                errors.push(r.error)
                continue
              }
              taken.add(r.key)
              rows.push(r)
            }
            for (const row of rows) add(row)
            if (!rows.length) message.error(errors[0] ?? '没有可导入的文件')
            else if (errors.length) message.warning(`已导入 ${rows.length} 个文件，${errors.join('；')}`)
            else message.success(`已导入 ${rows.length} 个数据文件`)
          }

          return (
            <>
              {fields.map(({ key, name: fieldName, ...restField }) => (
                <div key={key} className="mb-2 flex items-start gap-2">
                  <Form.Item {...restField} name={[fieldName, 'key']} className="!mb-0" style={{ width: 200 }}>
                    <Input placeholder="键" />
                  </Form.Item>
                  <Form.Item {...restField} name={[fieldName, 'value']} className="!mb-0 flex-1">
                    <Input.TextArea autoSize={{ minRows: 1, maxRows: 8 }} placeholder="值（支持多行，可粘贴整段配置）" />
                  </Form.Item>
                  <Button className="mt-0.5" size="small" type="text" icon={<MinusOutlined />} onClick={() => remove(fieldName)} disabled={fields.length <= minRows} />
                </div>
              ))}
              <div className="flex gap-2">
                <Button type="dashed" className="flex-1" icon={<PlusOutlined />} onClick={() => add({ key: '', value: '' })}>
                  添加数据项
                </Button>
                <Upload
                  multiple
                  showUploadList={false}
                  beforeUpload={(_file, fileList) => {
                    // antd 对每个文件各回调一次，只在整批的第一个文件时读取，避免重复导入
                    if (_file === fileList[0]) void importFiles(Array.from(fileList))
                    return false
                  }}
                >
                  <Button icon={<UploadOutlined />}>从文件添加</Button>
                </Upload>
              </div>
            </>
          )
        }}
      </Form.List>
    </Form.Item>
  )
}
