import { EyeOutlined } from '@ant-design/icons'
import { Alert, App, AutoComplete, Button, Checkbox, Collapse, Form, Input, InputNumber, Modal, Select, Typography } from 'antd'
import { useCallback, useState } from 'react'
import { helmApi } from '../../api/helm'
import type { HelmChart, HelmOperation, HelmRepoRow, HelmRelease } from '../../api/helm'
import { useClusterStore } from '../../store/useClusterStore'
import { NAME_RULE, isChartRef } from './util'

type Common = { cluster: string; onClose: () => void; onDone: () => void }

type Props = Common & (
  | { mode: 'install'; chart: HelmChart; repo: HelmRepoRow }
  | { mode: 'upgrade'; release: HelmRelease; repos: HelmRepoRow[] }
)

interface FormShape {
  name: string
  namespace: string
  chart: string
  version?: string
  repoId?: number
  values?: string
  createNamespace: boolean
  wait: boolean
  waitForJobs: boolean
  rollbackOnFailure: boolean
  reuseValues: boolean
  historyMax: number
  timeoutSec: number
}

/** helm 的失败原因在 stderr 最后几行，装不上时必须让操作人看见原文 */
function OutputBlock({ title, text }: { title: string; text: string }) {
  return (
    <Alert
      type="error"
      showIcon
      className="mt-3"
      message={title}
      description={<pre className="kbd-mono m-0 max-h-52 overflow-auto whitespace-pre-wrap text-xs">{text}</pre>}
    />
  )
}

/**
 * 安装与升级共用一张表单：字段九成相同，拆两份只会让 values 输入框和超时说明各写一遍。
 * 升级时 release 名与命名空间锁死——helm 的 upgrade 本来就是原地替换。
 */
export default function InstallForm(props: Props) {
  const { cluster, onClose, onDone } = props
  const installing = props.mode === 'install'
  const chart = installing ? props.chart : undefined
  const release = props.mode === 'upgrade' ? props.release : undefined
  const repoOptions = props.mode === 'upgrade' ? props.repos : []
  const fixedRepo = installing ? props.repo : undefined

  const { message } = App.useApp()
  const namespaces = useClusterStore((s) => s.namespaces)
  const [busy, setBusy] = useState(false)
  const [previewing, setPreviewing] = useState(false)
  const [yaml, setYaml] = useState('')
  const [failure, setFailure] = useState<HelmOperation | null>(null)
  const [form] = Form.useForm<FormShape>()

  const selectedRepoId = Form.useWatch('repoId', form)
  const repo = fixedRepo ?? repoOptions.find((r) => r.id === selectedRepoId)
  const repoId = repo?.id

  const initialValues: FormShape = installing
    ? {
        name: (chart?.name ?? '').slice(0, 53),
        namespace: 'default',
        chart: chart?.name ?? '',
        version: chart?.version,
        createNamespace: true,
        wait: false,
        waitForJobs: false,
        rollbackOnFailure: false,
        reuseValues: false,
        historyMax: 10,
        timeoutSec: 0,
      }
    : {
        name: release?.name ?? '',
        namespace: release?.namespace ?? 'default',
        chart: release?.chart ?? '',
        version: undefined,
        createNamespace: false,
        wait: false,
        waitForJobs: false,
        rollbackOnFailure: false,
        // 默认沿用线上值：升级最常见的动机是换版本，而不是顺手把整套值重写一遍
        reuseValues: true,
        historyMax: 10,
        timeoutSec: 0,
      }

  const versionOptions = (chart?.versions ?? []).map((v) => ({
    value: v.version,
    label: `${v.version}${v.appVersion ? ` · app ${v.appVersion}` : ''}${v.deprecated ? ' · 已废弃' : ''}`,
  }))

  /** 校验并抽出 values，预览与提交走同一份参数，看到的渲染结果就是将要安装的 */
  const collect = useCallback(async (): Promise<FormShape | null> => {
    try {
      return await form.validateFields()
    } catch {
      return null
    }
  }, [form])

  const preview = useCallback(async () => {
    const v = await collect()
    if (!v) return
    setPreviewing(true)
    setYaml('')
    try {
      const res = await helmApi.template({
        clustName: cluster,
        name: v.name,
        namespace: v.namespace || 'default',
        chart: v.chart,
        chartVersion: v.version || undefined,
        repoId,
        values: v.values?.trim() || undefined,
        skipCrds: false,
      })
      setYaml(res.yaml)
      if (!res.yaml.trim()) message.info('helm 没有渲染出任何资源')
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setPreviewing(false)
    }
  }, [cluster, collect, message, repoId])

  const submit = useCallback(async () => {
    const v = await collect()
    if (!v) return
    setBusy(true)
    setFailure(null)
    const shared = {
      clustName: cluster,
      name: v.name,
      namespace: v.namespace || 'default',
      chart: v.chart,
      chartVersion: v.version || undefined,
      repoId,
      values: v.values?.trim() || undefined,
      wait: v.wait,
      rollbackOnFailure: v.rollbackOnFailure,
      timeoutSec: v.timeoutSec || 0,
    }
    try {
      const op = installing
        ? await helmApi.install({
            ...shared,
            createNamespace: v.createNamespace,
            waitForJobs: v.waitForJobs,
          })
        : await helmApi.upgrade({
            ...shared,
            reuseValues: v.reuseValues,
            historyMax: v.historyMax || 0,
          })
      // helm 非零退出不会抛异常，失败原因跟着这次操作一起回来，摊开给人看
      if (op.message) {
        setFailure(op)
        return
      }
      message.success(`${installing ? '已提交安装' : '已升级'}：${op.name} 修订 ${op.revision}（${op.status || '未知状态'}）`)
      onDone()
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }, [cluster, collect, installing, message, onDone, repoId])

  return (
    <Modal
      open
      width={760}
      title={installing ? `安装 ${chart?.name ?? 'chart'}` : `升级 ${release?.name ?? ''}`}
      okText={installing ? '安装' : '升级'}
      cancelText="取消"
      confirmLoading={busy}
      onOk={() => void submit()}
      onCancel={onClose}
    >
      <Form form={form} layout="vertical" autoComplete="off" initialValues={initialValues}>
        <div className="grid grid-cols-2 gap-x-4">
          <Form.Item name="name" label="Release 名称" rules={NAME_RULE} extra="同一命名空间内唯一，之后升级回滚都靠它点名">
            <Input disabled={!installing} placeholder="例如 my-nginx" />
          </Form.Item>
          <Form.Item name="namespace" label="命名空间" rules={[{ required: true, message: '请填写命名空间' }]}>
            <AutoComplete
              disabled={!installing}
              placeholder="default"
              options={namespaces.map((n) => ({ value: n.name }))}
              filterOption={(input, option) => (option?.value ?? '').includes(input)}
            />
          </Form.Item>
        </div>

        <div className="grid grid-cols-2 gap-x-4">
          <Form.Item
            name="chart"
            label="Chart"
            rules={[{ required: true, message: '请填写 chart 名' }]}
            extra={installing ? `来自 ${fixedRepo?.name ?? '所选仓库'}` : '改这里等于换个 chart 升级，一般别动'}
          >
            <Input disabled={installing} />
          </Form.Item>
          {installing ? (
            <Form.Item name="version" label="Chart 版本" extra="仓库索引里的版本，新在前">
              {versionOptions.length ? (
                <Select showSearch options={versionOptions} optionFilterProp="value" placeholder="版本" />
              ) : (
                <Input placeholder="例如 1.2.3" />
              )}
            </Form.Item>
          ) : (
            <>
              <Form.Item
                name="repoId"
                label="来源仓库"
                dependencies={['chart']}
                extra="留空表示 Chart 已是可直接交给 helm 的引用（.tgz 地址或 oci://）"
                rules={[
                  ({ getFieldValue }) => ({
                    validator: (_, value) =>
                      value || isChartRef(String(getFieldValue('chart') ?? ''))
                        ? Promise.resolve()
                        : Promise.reject(new Error('Chart 填的是仓库里的 chart 名，要选来源仓库')),
                  }),
                ]}
              >
                <Select
                  allowClear
                  placeholder="选择仓库"
                  options={repoOptions.map((r) => ({ label: r.name, value: r.id }))}
                  onChange={() => form.setFieldValue('version', undefined)}
                />
              </Form.Item>
              <Form.Item name="version" label="升级到版本" extra="留空取仓库里的最新版">
                <Input placeholder="例如 4.10.0" />
              </Form.Item>
            </>
          )}
        </div>

        <Form.Item
          name="values"
          label="values.yaml"
          extra={
            installing
              ? '整段 YAML 由标准输入喂给 helm，留空就用 chart 默认值'
              : '生效值可在详情抽屉的「生效值」页签里对照；勾下面「沿用线上值」时这里只填要改的键'
          }
        >
          <Input.TextArea
            className="kbd-mono"
            spellCheck={false}
            rows={8}
            style={{ fontSize: 12 }}
            placeholder={'# 例如\nreplicaCount: 2'}
          />
        </Form.Item>

        {!installing && (
          <Form.Item name="reuseValues" valuePropName="checked" className="!mb-2">
            <Checkbox>沿用线上已有的值（不勾选则以本次填写作为完整覆盖）</Checkbox>
          </Form.Item>
        )}

        <div className="grid grid-cols-2 gap-x-4">
          <Form.Item name="wait" valuePropName="checked" className="!mb-2">
            <Checkbox>等资源就绪再返回</Checkbox>
          </Form.Item>
          <Form.Item name="rollbackOnFailure" valuePropName="checked" className="!mb-2">
            <Checkbox>失败自动退回上一个修订</Checkbox>
          </Form.Item>
          {installing ? (
            <Form.Item name="createNamespace" valuePropName="checked" className="!mb-2">
              <Checkbox>命名空间不存在时创建</Checkbox>
            </Form.Item>
          ) : (
            <Form.Item name="historyMax" label="保留修订数" extra="0 用 helm 默认">
              <InputNumber min={0} max={100} className="w-full" />
            </Form.Item>
          )}
          {installing && (
            <Form.Item name="waitForJobs" valuePropName="checked" className="!mb-2">
              <Checkbox>连带等待 Job 跑完（勾了等资源就绪才生效）</Checkbox>
            </Form.Item>
          )}
          <Form.Item name="timeoutSec" label="helm 超时（秒）" extra="0 用 helm 默认的 5 分钟">
            <InputNumber min={0} max={260} className="w-full" placeholder="0" />
          </Form.Item>
        </div>

        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          勾「等资源就绪」或「失败自动退回」时，这次请求会一直等到 helm 跑完，最长约 5 分钟。
        </Typography.Text>

        {failure && <OutputBlock title={`helm 没有成功：${failure.message}`} text={failure.output} />}

        <div className="mt-4">
          <Button icon={<EyeOutlined />} loading={previewing} onClick={() => void preview()}>
            预览渲染结果
          </Button>
        </div>
        {yaml && (
          <Collapse
            size="small"
            className="mt-3"
            defaultActiveKey={['yaml']}
            items={[
              {
                key: 'yaml',
                label: `helm template 输出（${yaml.split('\n').length} 行）`,
                children: <pre className="kbd-mono m-0 max-h-72 overflow-auto rounded bg-slate-50 p-3 text-xs">{yaml}</pre>,
              },
            ]}
          />
        )}
      </Form>
    </Modal>
  )
}
