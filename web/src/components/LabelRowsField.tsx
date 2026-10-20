import { Button, Flex, Form, Input, Typography } from 'antd'
import { MinusCircleOutlined, PlusOutlined } from '@ant-design/icons'

/**
 * KubeSphere 式的「标签」键/值成行编辑器，挂在任意 Form 下。
 * 字段值形状：{ key, value }[]，由 payloads.ts 的 labelsFromRows 归并成 Record。
 */
export function LabelRowsField({ name = 'LabelRows', label = '标签' }: { name?: string; label?: string }) {
  return (
    <>
      <Typography.Text type="secondary" className="mb-2 block">
        {label}
      </Typography.Text>
      <Form.List name={name}>
        {(rows, { add, remove }) => (
          <Flex vertical gap={4} className="mb-2">
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
    </>
  )
}

/** 描述输入框（写入 kubesphere.io/description 注解） */
export function DescriptionField({ name = 'Description', label = '描述' }: { name?: string; label?: string }) {
  return (
    <Form.Item label={label} name={name}>
      <Input.TextArea rows={2} placeholder="为该资源添加描述（可选）" />
    </Form.Item>
  )
}
