import { App, Button, Form, Input, InputNumber, Modal, Slider, Spin, Typography } from 'antd'
import { useCallback, useEffect, useState } from 'react'
import { clusterApi } from '../../api/cluster'
import type { CanaryApp } from '../../types/dto'

interface Props {
  open: boolean
  onClose: () => void
  cluster: string
  namespace: string
  /** 目标 Service 名，灰度经 nginx-ingress annotation 挂在其同名 Ingress 上 */
  name: string
  onChanged?: () => void
}

/** 读接口在无灰度时返回空对象，只能靠业务字段判断是否存在 */
const hasCanary = (d: CanaryApp | null) =>
  !!d && !!(d.deployment || d.image || d.service || d.weight != null)

export default function CanaryModal({ open, onClose, cluster, namespace, name, onChanged }: Props) {
  const { message, modal } = App.useApp()
  const [form] = Form.useForm<{ image: string; weight: number }>()
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [data, setData] = useState<CanaryApp | null>(null)
  const [weight, setWeight] = useState(20)
  const createWeight = Form.useWatch('weight', form) as number | undefined

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const d = await clusterApi.canary(cluster, namespace, name)
      setData(d)
      if (hasCanary(d)) setWeight(d.weight ?? 0)
    } catch (e) {
      message.error((e as Error).message)
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [cluster, namespace, name, message])

  useEffect(() => {
    if (open) void load()
  }, [open, load])

  const submitCreate = async () => {
    let values: { image: string; weight: number }
    try {
      values = await form.validateFields()
    } catch {
      return
    }
    setBusy(true)
    try {
      await clusterApi.createCanary(cluster, {
        Name: name,
        Namespace: namespace,
        Image: values.image.trim(),
        Weight: values.weight,
      })
      message.success('灰度已创建')
      form.resetFields()
      onChanged?.()
      await load()
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const submitWeight = async () => {
    setBusy(true)
    try {
      await clusterApi.changeWeight(cluster, namespace, name, weight)
      message.success(weight >= 100 ? '已全量切换到灰度镜像，灰度结束' : `灰度权重已调整为 ${weight}%`)
      onChanged?.()
      await load()
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const confirmRemove = () => {
    modal.confirm({
      title: `撤销 ${name} 的灰度？`,
      content: '将删除灰度 Deployment / Service / Ingress，全部流量回到稳定版本，此操作不可恢复。',
      okText: '撤销灰度',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await clusterApi.removeCanary(cluster, namespace, name)
          message.success('灰度已撤销')
          onChanged?.()
          await load()
        } catch (e) {
          message.error((e as Error).message)
        }
      },
    })
  }

  const existing = hasCanary(data)

  return (
    <Modal
      open={open}
      title={`金丝雀发布 · ${name}`}
      onCancel={onClose}
      footer={null}
      destroyOnHidden
    >
      <Spin spinning={loading}>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {cluster} / {namespace}
        </Typography.Text>

        {existing ? (
          <div className="mt-3 space-y-4">
            <div className="text-[13px]">
              <span style={{ color: 'var(--ks-muted)' }}>灰度镜像：</span>
              <span className="kbd-mono">{data?.image || '-'}</span>
            </div>
            <div>
              <div className="mb-1 flex items-center gap-3">
                <Slider
                  className="flex-1"
                  min={1}
                  max={100}
                  value={weight}
                  onChange={setWeight}
                  tooltip={{ formatter: (v) => `${v}% 的请求会打到灰度版本` }}
                />
                <InputNumber
                  min={1}
                  max={100}
                  value={weight}
                  onChange={(v) => setWeight(v ?? 1)}
                  addonAfter="%"
                  style={{ width: 110 }}
                />
              </div>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                当前 {weight}% 的请求会打到灰度版本，其余仍由稳定版本处理；调到 100% 将全量切换到灰度镜像并自动结束灰度。
              </Typography.Text>
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="primary"
                loading={busy}
                disabled={weight === (data?.weight ?? 0)}
                onClick={() => void submitWeight()}
              >
                调整权重
              </Button>
              <Button danger disabled={busy} onClick={confirmRemove}>
                撤销灰度
              </Button>
            </div>
          </div>
        ) : (
          <Form
            form={form}
            layout="vertical"
            className="mt-3"
            initialValues={{ weight: 20 }}
            onFinish={() => void submitCreate()}
          >
            <Form.Item
              name="image"
              label="灰度镜像"
              rules={[{ required: true, message: '必填' }]}
              extra="将按该镜像创建灰度 Deployment，并按权重从原 Service 的 Ingress 分流。"
            >
              <Input className="kbd-mono" placeholder="registry.example.com/app:v2" />
            </Form.Item>
            <Form.Item name="weight" label="灰度权重" rules={[{ required: true, message: '必填' }]}>
              <Slider min={0} max={100} tooltip={{ formatter: (v) => `${v}% 的请求会打到灰度版本` }} />
            </Form.Item>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {createWeight ?? 0}% 的请求会打到灰度版本，其余仍由当前稳定版本处理。
            </Typography.Text>
            <div className="mt-4">
              <Button type="primary" htmlType="submit" loading={busy}>
                创建灰度
              </Button>
            </div>
          </Form>
        )}
      </Spin>
    </Modal>
  )
}
