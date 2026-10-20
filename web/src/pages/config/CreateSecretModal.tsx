import { App, Button, Form, Input, Segmented, Typography, Upload } from 'antd'
import { UploadOutlined } from '@ant-design/icons'
import { useState } from 'react'
import type { UploadFile } from 'antd'
import KsCreateModal from '../../components/KsCreateModal'
import { DescriptionField, LabelRowsField } from '../../components/LabelRowsField'
import { clusterApi } from '../../api/cluster'
import { buildDockerSecretPayload, buildTlsSecretPayload } from '../../api/payloads'
import type { SecretFormValues as FormValues } from '../../api/payloads'
import { YamlPreview } from '../../components/YamlPreview'

interface Props {
  open: boolean
  onClose: () => void
  cluster: string
  namespace: string
  onCreated: () => void
}

type SecretKind = 'docker' | 'tls'
const NAME_PATTERN = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/

/** FileReader 读成 data URL 后去掉 data:application/...;base64, 前缀，只留裸 base64 */
function toBase64(dataUrl: string): string {
  const comma = dataUrl.indexOf(',')
  return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl
}

export function CreateSecretModal({ open, onClose, cluster, namespace, onCreated }: Props) {
  const { message } = App.useApp()
  const [form] = Form.useForm<FormValues>()
  const [kind, setKind] = useState<SecretKind>('docker')
  const [busy, setBusy] = useState(false)
  const [pfxBase64, setPfxBase64] = useState('')
  const [fileList, setFileList] = useState<UploadFile[]>([])

  const all = Form.useWatch([], form) as FormValues | undefined
  const ctx = { cluster, namespace }
  const preview =
    kind === 'docker'
      ? buildDockerSecretPayload(all ?? {}, ctx)
      : buildTlsSecretPayload(all ?? {}, pfxBase64, ctx)

  const reset = () => {
    form.resetFields()
    setPfxBase64('')
    setFileList([])
  }

  const close = () => {
    reset()
    onClose()
  }

  const submit = async () => {
    const values = await form.validateFields().catch(() => null)
    if (!values) return
    if (kind === 'docker') {
      const payload = buildDockerSecretPayload(values, ctx)
      await run(() => clusterApi.createDockerRegistrySecret(payload), values.name ?? '')
    } else {
      if (!pfxBase64) {
        message.error('请上传 .pfx / .p12 证书文件')
        return
      }
      const payload = buildTlsSecretPayload(values, pfxBase64, ctx)
      await run(() => clusterApi.createTlsSecret(payload), values.name ?? '')
    }
  }

  const run = async (fn: () => Promise<unknown>, label: string) => {
    setBusy(true)
    try {
      await fn()
      message.success(`密钥 ${label} 已创建`)
      onCreated()
      close()
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const beforeUpload = (file: File & { uid?: string }) => {
    if (!/\.(pfx|p12)$/i.test(file.name)) {
      message.error('仅支持 .pfx / .p12 文件')
      return Upload.LIST_IGNORE
    }
    const reader = new FileReader()
    reader.onload = () => setPfxBase64(toBase64(String(reader.result ?? '')))
    reader.onerror = () => {
      message.error('文件读取失败')
      setPfxBase64('')
    }
    reader.readAsDataURL(file)
    // 受控 fileList 展示所选文件名；beforeUpload 返回 false，不会真正上传
    setFileList([{ uid: file.uid ?? file.name, name: file.name, status: 'done' }])
    return false
  }

  return (
    <KsCreateModal
      open={open}
      title="创建密钥"
      onCancel={close}
      onOk={submit}
      okText="创建"
      okButtonProps={{ loading: busy, disabled: busy || (kind === 'tls' && !pfxBase64) }}
    >
      <Segmented
        block
        className="mb-4"
        value={kind}
        onChange={(v) => setKind(v as SecretKind)}
        options={[
          { label: '镜像仓库凭据', value: 'docker' },
          { label: 'TLS 证书', value: 'tls' },
        ]}
      />

      <Form form={form} layout="vertical" preserve={false}>
        <Form.Item
          name="name"
          label="名称"
          rules={[
            { required: true, message: '必填' },
            { pattern: NAME_PATTERN, message: '仅允许小写字母、数字和短横线，且以字母数字开头结尾' },
          ]}
        >
          <Input placeholder="harbor-secret" />
        </Form.Item>

        <Form.Item label="命名空间">
          <Input disabled value={namespace} />
        </Form.Item>

        {kind === 'docker' ? (
          <>
            <Form.Item
              name="domain"
              label="镜像仓库域名"
              rules={[{ required: true, message: '必填' }]}
              extra="凭据按域名生效，填仓库地址不带 http:// 和路径"
            >
              <Input placeholder="registry.example.com" />
            </Form.Item>
            <Form.Item name="username" label="用户名" rules={[{ required: true, message: '必填' }]}>
              <Input placeholder="admin" />
            </Form.Item>
            <Form.Item name="password" label="密码" rules={[{ required: true, message: '必填' }]}>
              <Input.Password placeholder="仓库密码" />
            </Form.Item>
          </>
        ) : (
          <>
            <Form.Item
              label="证书文件"
              required
              extra="仅支持 .pfx / .p12；服务端用 X509Certificate2 解析并导出 tls.crt / tls.key"
            >
              <Upload
                accept=".pfx,.p12"
                maxCount={1}
                fileList={fileList}
                beforeUpload={beforeUpload}
                onRemove={() => {
                  setPfxBase64('')
                  setFileList([])
                }}
              >
                <Button icon={<UploadOutlined />}>选择 .pfx / .p12 文件</Button>
              </Upload>
            </Form.Item>
            <Form.Item
              name="passphrase"
              label="密码"
              extra="加密的 PFX 必须填写导出密码；无口令的证书可留空"
            >
              <Input.Password placeholder="PFX 导出口令（如有）" />
            </Form.Item>
          </>
        )}

        <DescriptionField />
        <LabelRowsField />
      </Form>

      <Typography.Text type="secondary" className="!block text-xs">
        {kind === 'docker' ? '服务端自建 dockerconfigjson 类型密钥' : '服务端自建 kubernetes.io/tls 类型密钥'}
      </Typography.Text>

      <YamlPreview value={preview} />
    </KsCreateModal>
  )
}
