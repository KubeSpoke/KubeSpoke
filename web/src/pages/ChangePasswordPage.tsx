import { Alert, App, Button, Form, Input, Typography } from 'antd'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { authApi } from '../api/auth'
import BrandMark from '../components/BrandMark'
import { useAuthStore } from '../store/useAuthStore'

interface FormValues {
  oldPassword: string
  newPassword: string
  confirmPassword: string
}

/** 首次登录（口令是初始种子或管理员代设的）改密，不给跳过 */
export default function ChangePasswordPage() {
  const { message } = App.useApp()
  const navigate = useNavigate()
  const username = useAuthStore((s) => s.username)
  const signOut = useAuthStore((s) => s.logout)
  const [form] = Form.useForm<FormValues>()
  const [busy, setBusy] = useState(false)

  const submit = async (values: FormValues) => {
    setBusy(true)
    try {
      await authApi.changePassword(values.oldPassword, values.newPassword)
      message.success('密码已修改，请用新密码重新登录')
      await signOut()
      navigate('/login', { replace: true })
    } catch (e) {
      const res = (e as { response?: { data?: { message?: string } } }).response
      message.error(res?.data?.message ?? '修改失败')
      setBusy(false)
    }
  }

  return (
    <div
      className="ks-auth-bg grid h-screen w-full place-items-center px-6"

    >
      <div className="w-full max-w-[400px] ks-auth-card rounded-2xl px-8 py-8">
        <div className="mb-5 flex items-center gap-3">
          <BrandMark size={40} />
          <div>
            <Typography.Text className="!text-[18px] !font-bold" style={{ color: 'var(--ks-ink)' }}>
              KubeSpoke
            </Typography.Text>
            <div className="text-xs" style={{ color: 'var(--ks-muted)' }}>
              首次登录，请先修改密码
            </div>
          </div>
        </div>

        <Alert
          className="mb-5"
          type="warning"
          showIcon
          message={`当前账号 ${username || 'admin'} 仍在使用初始口令，改密后才能进入控制台。`}
        />

        <Form form={form} layout="vertical" requiredMark={false} onFinish={(values) => void submit(values)}>
          <Form.Item name="oldPassword" label="原密码" rules={[{ required: true, message: '请输入原密码' }]}>
            <Input.Password placeholder="初始口令" autoFocus />
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
                  !value || getFieldValue('newPassword') === value
                    ? Promise.resolve()
                    : Promise.reject(new Error('两次输入不一致')),
              }),
            ]}
          >
            <Input.Password placeholder="再次输入新密码" />
          </Form.Item>
          <Form.Item className="!mb-0">
            <Button type="primary" htmlType="submit" block loading={busy}>
              修改并重新登录
            </Button>
          </Form.Item>
        </Form>
      </div>
    </div>
  )
}
