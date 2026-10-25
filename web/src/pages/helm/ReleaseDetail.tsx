import { ReloadOutlined } from '@ant-design/icons'
import { App, Button, Descriptions, Empty, Spin, Table, Tabs, Typography } from 'antd'
import { useCallback, useState } from 'react'
import { helmApi } from '../../api/helm'
import type { HelmOperation, HelmRevision } from '../../api/helm'
import { DetailDrawer } from '../../components/DetailDrawer'
import { useResource } from '../../hooks/useResource'
import { HelmStatus } from './common'
import { chartLabel, helmTime } from './util'

interface Props {
  cluster: string
  namespace: string
  name: string
  onClose: () => void
  onChanged: () => void
  onUpgrade: () => void
}

/** 修订号是 helm 的账目主键：切到某一号，值和清单就按那一次的历史版本读回来 */
export function ReleaseDetail({ cluster, namespace, name, onClose, onChanged, onUpgrade }: Props) {
  const { message, modal } = App.useApp()
  const [revision, setRevision] = useState(0)
  const [busy, setBusy] = useState(false)

  const detail = useResource(() => helmApi.release(cluster, namespace, name, revision || undefined), [
    cluster, namespace, name, revision,
  ])
  const history = useResource(() => helmApi.history(cluster, namespace, name), [cluster, namespace, name])

  const report = useCallback(
    (op: HelmOperation, okText: string) => {
      if (op.message) {
        modal.error({
          title: `helm 没有成功：${op.message}`,
          width: 720,
          content: <pre className="kbd-mono m-0 max-h-72 overflow-auto whitespace-pre-wrap text-xs">{op.output}</pre>,
        })
        return
      }
      message.success(`${okText}：修订 ${op.revision}（${op.status || '未知状态'}）`)
      onChanged()
      history.refresh()
      detail.refresh()
    },
    [detail, history, message, modal, onChanged],
  )

  const rollback = useCallback(
    (target: number) => {
      modal.confirm({
        title: `回滚到修订 ${target || '上一个'}？`,
        content: 'helm 会按那一次修订的值与清单重新部署，并留下一条新的修订记录——回滚本身也是前进。',
        okText: '回滚',
        onOk: async () => {
          setBusy(true)
          try {
            const op = await helmApi.rollback({
              clustName: cluster,
              name,
              namespace,
              revision: target,
              wait: false,
              timeoutSec: 0,
            })
            report(op, '已提交回滚')
          } catch (e) {
            message.error((e as Error).message)
          } finally {
            setBusy(false)
          }
        },
      })
    },
    [cluster, message, modal, name, namespace, report],
  )

  const uninstall = useCallback(() => {
    modal.confirm({
      title: `卸载 ${name}？`,
      content: 'helm 会删掉这套 release 管理的全部资源，release 记录一并清掉。',
      okText: '卸载',
      okButtonProps: { danger: true },
      onOk: async () => {
        setBusy(true)
        try {
          const op = await helmApi.uninstall({
            clustName: cluster,
            name,
            namespace,
            keepHistory: false,
            timeoutSec: 0,
          })
          if (op.message) {
            message.error(`卸载失败：${op.message}`)
            return
          }
          message.success(op.output || '已卸载')
          onChanged()
          onClose()
        } catch (e) {
          message.error((e as Error).message)
        } finally {
          setBusy(false)
        }
      },
    })
  }, [cluster, message, modal, name, namespace, onClose, onChanged])

  const d = detail.data
  const rows = history.data?.items ?? []

  const textPane = (label: string, text: string) =>
    text.trim() ? (
      <pre className="kbd-mono m-0 max-h-[52vh] overflow-auto rounded bg-slate-50 p-3 text-xs">{text}</pre>
    ) : (
      <Empty className="!py-14" description={<span style={{ color: '#8f9aa9' }}>{label}为空</span>} />
    )

  return (
    <DetailDrawer
      open
      title={
        <span className="flex items-center gap-3">
          {name}
          {d && <HelmStatus status={d.status} />}
          {revision > 0 && <span className="text-xs text-[#8f9aa9]">查看修订 {revision}</span>}
        </span>
      }
      onClose={onClose}
      actions={
        <>
          <Button size="small" icon={<ReloadOutlined />} loading={detail.loading} onClick={() => detail.refresh()}>
            刷新
          </Button>
          <Button size="small" type="primary" onClick={onUpgrade}>
            升级
          </Button>
          <Button size="small" loading={busy} onClick={() => rollback(0)}>
            回到上一版
          </Button>
          <Button size="small" danger loading={busy} onClick={uninstall}>
            卸载
          </Button>
        </>
      }
    >
      <Spin spinning={detail.loading && !d}>
        <Tabs
          className="px-5 pt-1"
          items={[
            {
              key: 'info',
              label: '基本信息',
              children: (
                <div className="px-5 pb-5">
                  <Descriptions
                    size="small"
                    column={2}
                    bordered
                    items={[
                      { key: 'ns', label: '命名空间', children: namespace },
                      { key: 'rel', label: 'Release', children: name },
                      { key: 'chart', label: 'Chart', children: d ? chartLabel(d.chart, d.version) : '-' },
                      { key: 'app', label: '应用版本', children: d?.appVersion || '-' },
                      {
                        key: 'rev',
                        label: '当前修订',
                        children: (
                          <span>
                            {d?.revision ?? '-'}
                            {revision > 0 ? <span className="ml-1 text-xs text-[#8f9aa9]">（正在看 {revision}）</span> : null}
                          </span>
                        ),
                      },
                      { key: 'status', label: '状态', children: d ? <HelmStatus status={d.status} /> : '-' },
                    ]}
                  />
                  <Typography.Title level={5} style={{ marginTop: 20, fontSize: 14, fontWeight: 700 }}>
                    安装说明
                  </Typography.Title>
                  {textPane('安装说明', d?.notes ?? '')}
                </div>
              ),
            },
            {
              key: 'history',
              label: `修订历史${rows.length ? ` (${rows.length})` : ''}`,
              children: (
                <div className="px-5 pb-5">
                  <Table<HelmRevision>
                    rowKey="revision"
                    size="small"
                    loading={history.loading}
                    dataSource={rows}
                    pagination={{ hideOnSinglePage: true, showTotal: (t) => `共 ${t} 次修订` }}
                    locale={{ emptyText: '还没有修订记录' }}
                    columns={[
                      {
                        key: 'revision',
                        title: '修订',
                        width: 64,
                        render: (_, r) => (
                          <span className="font-medium" style={{ color: '#15233a' }}>
                            {r.revision}
                            {d && r.revision === d.revision ? (
                              <span className="ml-1 text-xs font-normal text-[#2f6fed]">当前</span>
                            ) : null}
                          </span>
                        ),
                      },
                      { key: 'status', title: '状态', width: 130, render: (_, r) => <HelmStatus status={r.status} /> },
                      {
                        key: 'chart',
                        title: 'Chart',
                        width: 170,
                        render: (_, r) => <span className="kbd-mono truncate text-xs">{chartLabel(r.chart, r.version)}</span>,
                      },
                      { key: 'app', title: '应用版本', width: 90, render: (_, r) => <span className="text-xs">{r.appVersion || '-'}</span> },
                      { key: 'desc', title: '说明', ellipsis: true, render: (_, r) => <span className="text-xs" style={{ color: '#5b6a80' }}>{r.description || '-'}</span> },
                      { key: 'updated', title: '时间', width: 155, render: (_, r) => <span className="whitespace-nowrap text-xs" style={{ color: '#5b6a80' }}>{helmTime(r.updated)}</span> },
                      {
                        key: 'ops',
                        title: '操作',
                        width: 130,
                        render: (_, r) => (
                          <span className="whitespace-nowrap">
                            <Button
                              size="small"
                              type="link"
                              style={{ paddingLeft: 0 }}
                              onClick={() => {
                                setRevision(r.revision)
                                message.info(`已切到修订 ${r.revision}，生效值与清单按这一号显示`)
                              }}
                            >
                              查看
                            </Button>
                            <Button size="small" type="link" loading={busy} onClick={() => rollback(r.revision)}>
                              回到这版
                            </Button>
                          </span>
                        ),
                      },
                    ]}
                  />
                  {revision > 0 && (
                    <Button size="small" className="mt-2" onClick={() => setRevision(0)}>
                      回到当前修订
                    </Button>
                  )}
                </div>
              ),
            },
            {
              key: 'values',
              label: '生效值',
              children: <div className="px-5 pb-5">{textPane('生效值', d?.values ?? '')}</div>,
            },
            {
              key: 'manifest',
              label: '资源清单',
              children: <div className="px-5 pb-5">{textPane('资源清单', d?.manifest ?? '')}</div>,
            },
          ]}
        />
      </Spin>
    </DetailDrawer>
  )
}
