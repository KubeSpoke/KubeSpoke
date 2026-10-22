import { Button, Form, Input } from 'antd'
import { MinusOutlined, PlusOutlined } from '@ant-design/icons'

/**
 * 配置字典「数据项」键/值成行编辑器，挂在任意 Form 下。
 * 字段值形状：{ key, value }[]，由 payloads.ts 的 dataFromRows 归并成 data。
 */
export function DataItemsField({ name = 'items', minRows = 1 }: { name?: string; minRows?: number }) {
  return (
    <Form.Item label="数据项" required>
      <Form.List name={name}>
        {(fields, { add, remove }) => (
          <>
            {fields.map(({ key, name: fieldName, ...restField }) => (
              <div key={key} className="mb-2 flex items-start gap-2">
                <Form.Item {...restField} name={[fieldName, 'key']} className="!mb-0" style={{ width: 200 }}>
                  <Input placeholder="键" />
                </Form.Item>
                <Form.Item {...restField} name={[fieldName, 'value']} className="!mb-0 flex-1">
                  <Input.TextArea autoSize={{ minRows: 1, maxRows: 8 }} placeholder="值（支持多行，可粘贴整段配置）" />
                </Form.Item>
                <Button
                  className="mt-0.5"
                  size="small"
                  type="text"
                  icon={<MinusOutlined />}
                  onClick={() => remove(fieldName)}
                  disabled={fields.length <= minRows}
                />
              </div>
            ))}
            <Button type="dashed" block icon={<PlusOutlined />} onClick={() => add({ key: '', value: '' })}>
              添加数据项
            </Button>
          </>
        )}
      </Form.List>
    </Form.Item>
  )
}
