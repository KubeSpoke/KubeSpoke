import { Alert, App, Button, Form, Input, Spin, Typography } from 'antd'
import { useEffect, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import BrandMark from '../components/BrandMark'
import { ADMIN_USERNAME, useAuthStore } from '../store/useAuthStore'

interface FormValues {
  password: string
  confirmPassword: string
}

/** 首次安装：库里还没有账号时，由第一位访问者设置管理员口令，设完直接进控制台 */
export default function InitPage() {
  const { message } = App.useApp()
  const navigate = useNavigate()
  const init = useAuthStore((s) => s.init)
  const status = useAuthStore((s) => s.status)
  const needsInit = useAuthStore((s) => s.needsInit)
  const probe = useAuthStore((s) => s.probe)
  const [form] = Form.useForm<FormValues>()
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void probe()
  }, [probe])

  const submit = async (values: FormValues) => {
    setBusy(true)
    try {
      await init(values.password)
      message.success('初始化完成，已进入控制台')
      navigate('/clusters', { replace: true })
    } catch (e) {
      message.error((e as Error).message || '设置失败')
      setBusy(false)
    }
  }

  if (status === 'unknown') {
    return (
      <div className="grid h-full place-items-center">
        <Spin />
      </div>
    )
  }
  // 已经有会话（刚设完口令）或已有账号，就不该再停在这个页面
  if (status === 'authed') return <Navigate to="/clusters" replace />
  if (!needsInit) return <Navigate to="/login" replace />

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
              首次安装，请设置管理员口令
            </div>
          </div>
        </div>

        <Alert
          className="mb-5"
          type="info"
          showIcon
          message={`该实例还没有任何账号。请由管理员本人为 ${ADMIN_USERNAME} 设置登录口令，设置完成后本页面即关闭。`}
        />

        <Form form={form} layout="vertical" requiredMark={false} onFinish={(values) => void submit(values)}>
          <Form.Item
            name="password"
            label="管理员口令"
            rules={[
              { required: true, message: '请输入口令' },
              { min: 6, message: '至少 6 位' },
            ]}
          >
            <Input.Password placeholder="至少 6 位" autoFocus />
          </Form.Item>
          <Form.Item
            name="confirmPassword"
            label="确认口令"
            dependencies={['password']}
            rules={[
              { required: true, message: '请再次输入口令' },
              ({ getFieldValue }) => ({
                validator: (_, value) =>
                  !value || getFieldValue('password') === value
                    ? Promise.resolve()
                    : Promise.reject(new Error('两次输入不一致')),
              }),
            ]}
          >
            <Input.Password placeholder="再次输入口令" />
          </Form.Item>
          <Form.Item className="!mb-0">
            <Button type="primary" htmlType="submit" block loading={busy}>
              设置并进入控制台
            </Button>
          </Form.Item>
        </Form>
      </div>
    </div>
  )
}
