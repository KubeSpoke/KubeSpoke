import {
  AppstoreOutlined,
  LockOutlined,
  SafetyOutlined,
  ThunderboltOutlined,
  UserOutlined,
  WechatOutlined,
} from '@ant-design/icons'
import { App, Button, Checkbox, Divider, Form, Input, Spin, Typography } from 'antd'
import { useEffect, useState } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import BrandMark from '../components/BrandMark'
import { CHANGE_PASSWORD_PATH, INIT_PATH, useAuthStore } from '../store/useAuthStore'

interface FormValues {
  username: string
  password: string
  remember?: boolean
}

const REMEMBER_KEY = 'kubespoke.login.username'

/** 只接受站内绝对路径，且不能指回登录页自己，避免 redirect 参数把用户绕进循环 */
function safeRedirect(raw: string | null) {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return ''
  if (raw.split('?')[0].startsWith('/login')) return ''
  return raw
}

const FEATURES = [
  { icon: <AppstoreOutlined />, title: '多集群管理', desc: '统一视图 集中管控' },
  { icon: <SafetyOutlined />, title: '安全可靠', desc: 'RBAC 细粒度权限' },
  { icon: <ThunderboltOutlined />, title: '高效运维', desc: '监控告警 快速响应' },
  { icon: <CodeIcon />, title: 'DevOps 工具链', desc: 'CI/CD 应用交付' },
]

function CodeIcon() {
  return (
    <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" aria-hidden style={{ fontSize: 20 }}>
      <path
        d="M8 6 3 12l5 6M16 6l5 6-5 6M13.5 4l-3 16"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** 登录页：浅色品牌区（标语 + 特性 + 等距插画）+ 右侧登录卡 */
export default function LoginPage() {
  const { message } = App.useApp()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  // 初始口令没改过的账号登录后先落改密页；redirect 参数带的是业务路径，改完密还要用得上
  const mustChangePassword = useAuthStore((s) => s.mustChangePassword)
  const target = safeRedirect(params.get('redirect')) || '/clusters'
  const dest = mustChangePassword ? CHANGE_PASSWORD_PATH : target

  const status = useAuthStore((s) => s.status)
  const needsInit = useAuthStore((s) => s.needsInit)
  const probe = useAuthStore((s) => s.probe)
  const login = useAuthStore((s) => s.login)
  const [busy, setBusy] = useState(false)
  const [form] = Form.useForm<FormValues>()

  // 已登录的人直接访问 /login 时，问一次会话后就放行到主界面
  useEffect(() => {
    void probe()
  }, [probe])

  useEffect(() => {
    const saved = localStorage.getItem(REMEMBER_KEY)
    if (saved) form.setFieldsValue({ username: saved, remember: true })
  }, [form])

  if (status === 'unknown') {
    return (
      <div className="grid h-full place-items-center">
        <Spin />
      </div>
    )
  }
  if (status === 'authed') return <Navigate to={dest} replace />
  // 一个账号都还没有，先去设管理员口令，登录页此时没有可用凭据
  if (needsInit) return <Navigate to={INIT_PATH} replace />

  const submit = async (values: FormValues) => {
    const username = values.username.trim()
    setBusy(true)
    try {
      await login(username, values.password)
      if (values.remember) localStorage.setItem(REMEMBER_KEY, username)
      else localStorage.removeItem(REMEMBER_KEY)
      message.success('登录成功')
      navigate(dest, { replace: true })
    } catch (e) {
      message.error((e as Error).message || '登录失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="flex h-screen w-full overflow-hidden"
      style={{
        background:
          'radial-gradient(1200px 700px at 12% 8%, #eaf2ff 0%, rgba(234,242,255,0) 55%), radial-gradient(900px 600px at 88% 90%, #e8f8f1 0%, rgba(232,248,241,0) 50%), linear-gradient(160deg, #f7fafd 0%, #eef4fb 100%)',
      }}
    >
      {/* 品牌区 */}
      <div className="hidden min-h-0 min-w-0 flex-1 flex-col justify-center px-14 py-6 xl:flex 2xl:px-24">
        <div className="mb-6 flex items-center gap-4">
          <BrandMark size={56} />
          <div>
            <div className="text-[26px] font-bold leading-tight tracking-tight" style={{ color: '#1d2b45' }}>
              KubeSpoke
            </div>
            <div className="text-sm" style={{ color: '#7b8ba3' }}>
              Multi-Cluster Kubernetes DevOps Platform
            </div>
          </div>
        </div>

        <h1 className="m-0 text-[34px] font-bold leading-tight" style={{ color: '#16233c' }}>
          连接多集群 <span style={{ color: '#9aa7ba' }}>·</span> 统一运维
        </h1>
        <p className="mt-2 text-[16px]" style={{ color: '#7f8ea6' }}>
          让 Kubernetes 管理更简单、更高效
        </p>

        <div className="mt-6 flex flex-wrap gap-x-10 gap-y-4">
          {FEATURES.map((f) => (
            <div key={f.title} className="flex items-start gap-3">
              <span
                className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-[18px]"
                style={{ background: '#eaf1fe', color: '#2f6fed' }}
              >
                {f.icon}
              </span>
              <div>
                <div className="text-[15px] font-semibold leading-6" style={{ color: '#22314c' }}>
                  {f.title}
                </div>
                <div className="text-xs leading-5" style={{ color: '#8b99ae' }}>
                  {f.desc}
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="relative mt-4 min-h-0 flex-1">
          <img src="/login-hero.svg" alt="" className="h-full w-full object-contain object-left" />
          <div
            className="absolute bottom-2 left-0 text-[22px] italic"
            style={{ color: '#3b76e0', fontFamily: "'Segoe Script', 'Comic Sans MS', cursive" }}
          >
            One Platform, All Clusters
          </div>
        </div>
      </div>

      {/* 表单区 */}
      <div className="flex min-h-0 w-full items-center justify-center px-6 py-6 xl:w-[46%] xl:max-w-[620px]">
        <div className="w-full max-w-[420px] rounded-2xl bg-white px-8 py-7" style={{ boxShadow: '0 18px 50px rgba(23,51,96,0.12)' }}>
          <div className="mb-5 flex items-center gap-3">
            <BrandMark size={44} />
            <div>
              <div className="text-[19px] font-bold leading-tight" style={{ color: '#1d2b45' }}>
                KubeSpoke
              </div>
              <div className="text-xs" style={{ color: '#8b99ae' }}>
                DevOps Platform
              </div>
            </div>
          </div>

          <Typography.Title level={3} style={{ margin: 0, color: '#16233c', fontWeight: 700 }}>
            欢迎回来
          </Typography.Title>
          <Typography.Text type="secondary" style={{ fontSize: 13 }}>
            登录后继续使用 KubeSpoke
          </Typography.Text>

          <Form<FormValues> form={form} layout="vertical" onFinish={submit} requiredMark={false} className="!mt-5">
            <Form.Item
              name="username"
              label={<span style={{ fontSize: 13 }}>用户名</span>}
              rules={[{ required: true, message: '请输入用户名' }]}
              className="!mb-4"
            >
              <Input
                size="large"
                prefix={<UserOutlined style={{ color: '#a8b3c4' }} />}
                placeholder="请输入用户名或邮箱"
                autoComplete="username"
              />
            </Form.Item>
            <Form.Item
              name="password"
              label={<span style={{ fontSize: 13 }}>密码</span>}
              rules={[{ required: true, message: '请输入密码' }]}
              className="!mb-3"
            >
              <Input.Password
                size="large"
                prefix={<LockOutlined style={{ color: '#a8b3c4' }} />}
                placeholder="请输入密码"
                autoComplete="current-password"
              />
            </Form.Item>

            <div className="mb-5 flex items-center justify-between">
              <Form.Item name="remember" valuePropName="checked" noStyle>
                <Checkbox>记住我</Checkbox>
              </Form.Item>
              <Typography.Link style={{ fontSize: 13, color: '#2f6fed' }} onClick={() => message.info('请联系管理员重置密码')}>
                忘记密码？
              </Typography.Link>
            </div>

            <Form.Item className="!mb-0">
              <Button
                type="primary"
                size="large"
                htmlType="submit"
                block
                loading={busy}
                style={{
                  height: 46,
                  borderRadius: 10,
                  fontWeight: 600,
                  border: 'none',
                  background: 'linear-gradient(90deg, #3f8cff 0%, #1f5fe0 100%)',
                  boxShadow: '0 8px 20px rgba(47,111,237,0.32)',
                }}
              >
                登录
              </Button>
            </Form.Item>
          </Form>

          <Divider plain style={{ margin: '16px 0 12px', color: '#9aa7ba', fontSize: 12 }}>
            其他登录方式
          </Divider>
          <Button block size="large" icon={<WechatOutlined style={{ color: '#2f6fed' }} />} onClick={() => message.info('企业微信登录暂未开放')}>
            企业微信登录
          </Button>
        </div>
      </div>
    </div>
  )
}
