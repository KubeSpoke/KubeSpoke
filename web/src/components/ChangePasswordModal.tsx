import { App, Form, Input, Modal } from 'antd'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { authApi } from '../api/auth'
import { useAuthStore } from '../store/useAuthStore'

interface Props {
  open: boolean
  onClose: () => void
}

interface FormValues {
  oldPassword: string
  newPassword: string
  confirmPassword: string
}

/** 修改当前账号密码；服务端改密后强制登出，成功后回登录页用新密码重登 */
export function ChangePasswordModal({ open, onClose }: Props) {
  const { message } = App.useApp()
  const [form] = Form.useForm<FormValues>()
  const [submitting, setSubmitting] = useState(false)
  const navigate = useNavigate()

  const submit = async () => {
    const values = await form.validateFields()
    setSubmitting(true)
    try {
      await authApi.changePassword(values.oldPassword, values.newPassword)
      useAuthStore.setState({ username: '', status: 'anon' })
      message.success('密码已修改，请重新登录')
      onClose()
      navigate('/login', { replace: true })
    } catch (e) {
      const res = (e as { response?: { data?: { message?: string } } }).response
      message.error(res?.data?.message ?? '修改失败')
      setSubmitting(false)
    }
  }

  return (
    <Modal
      title="修改密码"
      open={open}
      onCancel={() => {
        form.resetFields()
        setSubmitting(false)
        onClose()
      }}
      onOk={() => void submit()}
      okText="确认修改"
      cancelText="取消"
      confirmLoading={submitting}
      destroyOnHidden
    >
      <Form form={form} layout="vertical" requiredMark={false} className="!mt-4">
        <Form.Item name="oldPassword" label="原密码" rules={[{ required: true, message: '请输入原密码' }]}>
          <Input.Password placeholder="原密码" />
        </Form.Item>
        <Form.Item
          name="newPassword"
          label="新密码"
          rules={[
            { required: true, message: '请输入新密码' },
            { min: 6, message: '至少 6 位' },
          ]}
        >
          <Input.Password placeholder="至少 6 位" />
        </Form.Item>
        <Form.Item
          name="confirmPassword"
          label="确认新密码"
          dependencies={['newPassword']}
          rules={[
            { required: true, message: '请再次输入新密码' },
            ({ getFieldValue }) => ({
              validator: (_, value) =>
                !value || getFieldValue('newPassword') === value ? Promise.resolve() : Promise.reject(new Error('两次输入不一致')),
            }),
          ]}
        >
          <Input.Password placeholder="再次输入新密码" />
        </Form.Item>
      </Form>
    </Modal>
  )
}
