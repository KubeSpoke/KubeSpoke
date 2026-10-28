import { DatabaseOutlined, DeleteOutlined, PlusOutlined, RightOutlined } from '@ant-design/icons'
import { App, Button, Checkbox, Form, Input, Modal, Table, Tag } from 'antd'
import { useCallback, useState } from 'react'
import { helmApi } from '../../api/helm'
import type { HelmRepoPayload, HelmRepoRow } from '../../api/helm'
import { NameCell, PageShell } from '../../components/PageShell'
import { helmTime } from './util'

interface Props {
  /** 列表由 HelmPage 统一取，三个页签共用同一份仓库数据 */
  repos: HelmRepoRow[]
  loading: boolean
  error: string
  onRefresh: () => void
  /** 从仓库列表直接跳到市场并选中它 */
  onPick: (repoId: number) => void
}

interface FormShape {
  name: string
  url: string
  username?: string
  password?: string
  insecure: boolean
  auth: boolean
}

/**
 * Chart 仓库配置。口令只落到服务端库里，列表接口不回传，所以这一页填进去的密码
 * 之后再也看不见——要改只能删了重加，和隧道 Token 一个口径。
 */
export default function ReposTab({ repos, loading, error, onRefresh, onPick }: Props) {
  const { message, modal } = App.useApp()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [deleting, setDeleting] = useState<number>()
  const [form] = Form.useForm<FormShape>()

  const submit = useCallback(async () => {
    let values: FormShape
    try {
      values = await form.validateFields()
    } catch {
      return
    }
    setBusy(true)
    try {
      const payload: HelmRepoPayload = {
        name: values.name.trim(),
        url: values.url.trim(),
        username: values.auth ? values.username?.trim() || undefined : undefined,
        password: values.auth ? values.password || undefined : undefined,
        insecure: values.insecure,
      }
      await helmApi.addRepo(payload)
      message.success('仓库已添加')
      setOpen(false)
      onRefresh()
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }, [form, message, onRefresh])

  const remove = useCallback(
    (row: HelmRepoRow) => {
      modal.confirm({
        title: `删除仓库 ${row.name}？`,
        content: '只影响市场里还能不能看到它的 chart，已经装出来的应用不受影响。',
        okText: '删除',
        okButtonProps: { danger: true },
        onOk: async () => {
          setDeleting(row.id)
          try {
            await helmApi.removeRepo(row.id)
            message.success('已删除')
            onRefresh()
          } catch (e) {
            message.error((e as Error).message)
          } finally {
            setDeleting(undefined)
          }
        },
      })
    },
    [modal, message, onRefresh],
  )

  return (
    <PageShell
      title="Chart 仓库"
      description="一个仓库地址对应一份 index.yaml 目录；私有仓库的用户名口令存在控制台库里，不会下发到浏览器。"
      icon={<DatabaseOutlined />}
      namespaced={false}
      bare
      error={error}
      loading={loading}
      onRefresh={onRefresh}
      actions={
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => {
            form.resetFields()
            setOpen(true)
          }}
        >
          添加仓库
        </Button>
      }
      flush
    >
      <Table<HelmRepoRow>
        rowKey="id"
        size="small"
        loading={loading}
        dataSource={repos}
        scroll={{ x: 900 }}
        locale={{ emptyText: '还没有仓库，点右上角添加；公共仓库如 bitnami、ingress-nginx 填 https 索引地址即可' }}
        pagination={{ hideOnSinglePage: true, showTotal: (t) => `共 ${t} 个仓库` }}
        columns={[
          {
            key: 'name',
            title: '仓库',
            width: 300,
            render: (_, r) => <NameCell title={r.name} sub={r.url} />,
          },
          {
            key: 'auth',
            title: '凭据',
            width: 170,
            render: (_, r) => (
              <span className="flex flex-wrap gap-1">
                {r.hasPassword ? <Tag color="blue">用户名口令</Tag> : <Tag>匿名访问</Tag>}
                {r.insecure && <Tag color="orange">跳过证书</Tag>}
              </span>
            ),
          },
          {
            key: 'username',
            title: '用户名',
            width: 140,
            render: (_, r) => <span className="text-xs" style={{ color: 'var(--ks-body)' }}>{r.username || '—'}</span>,
          },
          {
            key: 'addedAt',
            title: '添加时间',
            width: 170,
            render: (_, r) => (
              <span className="whitespace-nowrap text-xs" style={{ color: 'var(--ks-body)' }}>
                {helmTime(r.addedAt)}
                {r.createdBy ? ` · ${r.createdBy}` : ''}
              </span>
            ),
          },
          {
            key: 'actions',
            title: '操作',
            width: 150,
            render: (_, r) => (
              <span className="whitespace-nowrap">
                <Button size="small" type="link" style={{ paddingLeft: 0 }} onClick={() => onPick(r.id)}>
                  逛目录 <RightOutlined style={{ fontSize: 9 }} />
                </Button>
                <Button
                  size="small"
                  type="link"
                  danger
                  icon={<DeleteOutlined />}
                  loading={deleting === r.id}
                  onClick={() => remove(r)}
                >
                  删除
                </Button>
              </span>
            ),
          },
        ]}
      />

      <Modal
        title="添加 Chart 仓库"
        width={620}
        open={open}
        okText="添加"
        cancelText="取消"
        confirmLoading={busy}
        onOk={() => void submit()}
        onCancel={() => setOpen(false)}
      >
        <Form
          form={form}
          layout="vertical"
          autoComplete="off"
          initialValues={{ insecure: false, auth: false }}
        >
          <Form.Item name="name" label="仓库名称" rules={[{ required: true, message: '请填写仓库名称' }]}>
            <Input placeholder="例如 bitnami" maxLength={64} />
          </Form.Item>
          <Form.Item
            name="url"
            label="仓库地址"
            extra="填 index.yaml 所在的仓库根地址，末尾不用带 /index.yaml"
            rules={[
              { required: true, message: '请填写仓库地址' },
              { pattern: /^https?:\/\//i, message: '要填 http(s) 完整链接' },
            ]}
          >
            <Input placeholder="https://charts.bitnami.com/bitnami" maxLength={500} />
          </Form.Item>

          <Form.Item name="auth" valuePropName="checked" className="!mb-3">
            <Checkbox>该仓库需要用户名口令</Checkbox>
          </Form.Item>
          <Form.Item shouldUpdate={(prev, next) => prev.auth !== next.auth} noStyle>
            {({ getFieldValue }) =>
              getFieldValue('auth') ? (
                <div className="grid grid-cols-2 gap-x-4">
                  <Form.Item name="username" label="用户名" rules={[{ required: true, message: '请填写用户名' }]}>
                    <Input maxLength={200} />
                  </Form.Item>
                  <Form.Item name="password" label="口令" rules={[{ required: true, message: '请填写口令' }]}>
                    <Input.Password autoComplete="new-password" />
                  </Form.Item>
                </div>
              ) : null
            }
          </Form.Item>

          <Form.Item name="insecure" valuePropName="checked" className="!mb-0">
            <Checkbox>跳过证书校验（自建仓库自签证书时用）</Checkbox>
          </Form.Item>
        </Form>
      </Modal>
    </PageShell>
  )
}
