import { AppstoreOutlined, DownOutlined, ExclamationCircleOutlined, PlusOutlined } from '@ant-design/icons'
import { Alert, App, Button, Dropdown, Input, Select, Table, Typography } from 'antd'
import { useCallback, useMemo, useState } from 'react'
import { helmApi } from '../../api/helm'
import type { HelmCapability, HelmRelease, HelmRepoRow } from '../../api/helm'
import { NameCell, PageShell, StatStrip } from '../../components/PageShell'
import { useResource } from '../../hooks/useResource'
import { HelmStatus } from './common'
import { chartLabel, helmTime } from './util'
import InstallForm from './InstallForm'
import { ReleaseDetail } from './ReleaseDetail'

interface Props {
  cluster: string
  repos: HelmRepoRow[]
  /** agent 侧有没有 helm 可执行文件；没就绪时这一页不发请求，只说明去哪重新下发 agent */
  capability?: HelmCapability
  /** 本页没有安装入口，装新应用一律回市场 */
  onMarket: () => void
}

const isDeployed = (s: string) => s.toLowerCase() === 'deployed'
const isPending = (s: string) => s.toLowerCase().startsWith('pending') || s.toLowerCase() === 'uninstalling'

export default function ReleasesTab({ cluster, repos, capability, onMarket }: Props) {
  const { message, modal } = App.useApp()
  const [namespace, setNamespace] = useState<string>()
  const [keyword, setKeyword] = useState('')
  const [upgrading, setUpgrading] = useState<HelmRelease | null>(null)
  const [detailKey, setDetailKey] = useState<{ ns: string; name: string } | null>(null)
  const [busyName, setBusyName] = useState<string>()

  const blocked = capability !== undefined && !capability.ready

  const { data, error, loading, refresh } = useResource(
    async () => {
      if (!cluster || blocked) return { total: 0, items: [] as HelmRelease[] }
      return helmApi.releases(cluster)
    },
    [cluster, blocked],
  )

  const nsOptions = useMemo(
    () => [...new Set((data?.items ?? []).map((r) => r.namespace))].sort().map((n) => ({ label: n, value: n })),
    [data],
  )

  const rows = useMemo(() => {
    let rs = data?.items ?? []
    if (namespace) rs = rs.filter((r) => r.namespace === namespace)
    const q = keyword.trim().toLowerCase()
    if (q) rs = rs.filter((r) => r.name.toLowerCase().includes(q) || r.chart.toLowerCase().includes(q))
    return rs
  }, [data, namespace, keyword])

  const counts = useMemo(() => {
    const all = data?.items ?? []
    return {
      total: all.length,
      deployed: all.filter((r) => isDeployed(r.status)).length,
      pending: all.filter((r) => isPending(r.status)).length,
      failed: all.filter((r) => !isDeployed(r.status) && !isPending(r.status)).length,
    }
  }, [data])

  const rollbackPrevious = useCallback(
    (row: HelmRelease) => {
      modal.confirm({
        title: `把 ${row.name} 退回上一个修订？`,
        content: 'helm 会按上一次修订的值与清单重新部署，并留下一条新的修订记录。',
        okText: '回滚',
        onOk: async () => {
          setBusyName(row.name)
          try {
            const op = await helmApi.rollback({
              clustName: cluster,
              name: row.name,
              namespace: row.namespace,
              revision: 0,
              wait: false,
              timeoutSec: 0,
            })
            if (op.message) {
              modal.error({
                title: `helm 没有成功：${op.message}`,
                width: 720,
                content: (
                  <pre className="kbd-mono m-0 max-h-72 overflow-auto whitespace-pre-wrap text-xs">{op.output}</pre>
                ),
              })
              return
            }
            message.success(`已提交回滚：修订 ${op.revision}（${op.status || '未知状态'}）`)
            refresh()
          } catch (e) {
            message.error((e as Error).message)
          } finally {
            setBusyName(undefined)
          }
        },
      })
    },
    [cluster, message, modal, refresh],
  )

  const uninstall = useCallback(
    (row: HelmRelease) => {
      modal.confirm({
        title: `卸载 ${row.name}？`,
        content: 'helm 会删掉这套 release 管理的全部资源，release 记录一并清掉。',
        okText: '卸载',
        okButtonProps: { danger: true },
        onOk: async () => {
          setBusyName(row.name)
          try {
            const op = await helmApi.uninstall({
              clustName: cluster,
              name: row.name,
              namespace: row.namespace,
              keepHistory: false,
              timeoutSec: 0,
            })
            if (op.message) message.error(`卸载失败：${op.message}`)
            else message.success(op.output || '已卸载')
            refresh()
          } catch (e) {
            message.error((e as Error).message)
          } finally {
            setBusyName(undefined)
          }
        },
      })
    },
    [cluster, message, modal, refresh],
  )

  return (
    <PageShell
      title="已安装应用"
      description="集群里由 helm 管起来的 release：升级、回滚、卸载都按修订记录走。"
      icon={<AppstoreOutlined />}
      namespaced={false}
      bare
      error={error}
      loading={loading}
      onRefresh={refresh}
      stats={
        <StatStrip
          items={[
            { value: counts.total, label: 'release 总数' },
            { value: counts.deployed, label: 'deployed' },
            { value: counts.pending, label: '进行中' },
            { value: counts.failed, label: '其他状态' },
          ]}
        />
      }
      search={
        <Input
          style={{ width: 220 }}
          allowClear
          placeholder="搜索 release 名或 chart"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
        />
      }
      actions={
        <>
          <Button icon={<PlusOutlined />} onClick={onMarket}>
            安装新应用
          </Button>
          <Select
            allowClear
            placeholder="全部命名空间"
            style={{ width: 150 }}
            value={namespace}
            onChange={setNamespace}
            options={nsOptions}
          />
        </>
      }
      flush
    >
      {blocked ? (
        <Alert
          className="mx-5 my-4"
          type="warning"
          showIcon
          icon={<ExclamationCircleOutlined />}
          message="当前集群的 agent 里没有 helm 可执行文件"
          description={
            <span>
              {capability?.error || '未给出原因'}
              <Typography.Text type="secondary" className="mt-1 block" style={{ fontSize: 12 }}>
                用带 helm 的 agent 镜像（Dockerfile-agent 已内置）重新下发这个集群的 agent 后，本页即可读取 release。
              </Typography.Text>
            </span>
          }
        />
      ) : (
        <Table<HelmRelease>
          rowKey={(r) => `${r.namespace}/${r.name}`}
          size="small"
          loading={loading}
          dataSource={rows}
          scroll={{ x: 1040 }}
          locale={{ emptyText: cluster ? '这个集群还没有 helm release，可去应用市场安装' : '请先选择集群' }}
          pagination={{ hideOnSinglePage: true, showTotal: (t) => `共 ${t} 条` }}
          onRow={(r) => ({
            onClick: (e) => {
              if ((e.target as HTMLElement).closest('button,a,input')) return
              setDetailKey({ ns: r.namespace, name: r.name })
            },
          })}
          columns={[
            {
              key: 'name',
              title: '应用',
              width: 240,
              sorter: (a, b) => a.name.localeCompare(b.name),
              render: (_, r) => <NameCell title={r.name} sub={chartLabel(r.chart, r.version)} />,
            },
            {
              key: 'namespace',
              title: '命名空间',
              width: 130,
              sorter: (a, b) => a.namespace.localeCompare(b.namespace),
              render: (_, r) => <span className="text-xs" style={{ color: 'var(--ks-body)' }}>{r.namespace}</span>,
            },
            { key: 'status', title: '状态', width: 140, render: (_, r) => <HelmStatus status={r.status} /> },
            {
              key: 'revision',
              title: '修订',
              width: 70,
              sorter: (a, b) => a.revision - b.revision,
              render: (_, r) => <span className="kbd-mono text-xs">{r.revision}</span>,
            },
            {
              key: 'appVersion',
              title: '应用版本',
              width: 120,
              render: (_, r) => <span className="kbd-mono text-xs">{r.appVersion || '-'}</span>,
            },
            {
              key: 'updated',
              title: '更新时间',
              width: 170,
              render: (_, r) => <span className="whitespace-nowrap text-xs" style={{ color: 'var(--ks-body)' }}>{helmTime(r.updated)}</span>,
            },
            { key: 'description', title: '说明', ellipsis: true, render: (_, r) => <span className="text-xs" style={{ color: 'var(--ks-muted)' }}>{r.description || '-'}</span> },
            {
              key: 'ops',
              title: '操作',
              width: 190,
              render: (_, r) => (
                <span className="whitespace-nowrap">
                  <Button size="small" type="link" style={{ paddingLeft: 0 }} onClick={() => setDetailKey({ ns: r.namespace, name: r.name })}>
                    详情
                  </Button>
                  <Button size="small" type="link" onClick={() => setUpgrading(r)}>
                    升级
                  </Button>
                  <Dropdown
                    trigger={['click']}
                    menu={{
                      items: [
                        { key: 'rollback', label: '退回上一个修订', onClick: () => rollbackPrevious(r) },
                        { key: 'uninstall', label: '卸载', danger: true, onClick: () => uninstall(r) },
                      ],
                    }}
                  >
                    <Button size="small" type="link" loading={busyName === r.name}>
                      更多 <DownOutlined style={{ fontSize: 9 }} />
                    </Button>
                  </Dropdown>
                </span>
              ),
            },
          ]}
        />
      )}

      {upgrading && (
        <InstallForm
          mode="upgrade"
          cluster={cluster}
          release={upgrading}
          repos={repos}
          onClose={() => setUpgrading(null)}
          onDone={() => {
            setUpgrading(null)
            refresh()
          }}
        />
      )}

      {detailKey && (
        <ReleaseDetail
          cluster={cluster}
          namespace={detailKey.ns}
          name={detailKey.name}
          onClose={() => setDetailKey(null)}
          onChanged={refresh}
          onUpgrade={() => {
            const row = rows.find((r) => r.namespace === detailKey.ns && r.name === detailKey.name) ?? null
            setDetailKey(null)
            setUpgrading(row)
          }}
        />
      )}
    </PageShell>
  )
}
