import { SettingOutlined } from '@ant-design/icons'
import { App, Button, Divider, InputNumber, Tag, Typography } from 'antd'
import { useState } from 'react'
import { systemApi } from '../api/system'
import { PageShell } from '../components/PageShell'
import { useResource } from '../hooks/useResource'

/**
 * 平台级设置：跟具体集群无关、对整个控制台生效的参数。
 * 现在只有一项——等 Agent 回执的时限。
 */
export default function SystemSettingsPage() {
  const { message } = App.useApp()
  const { data, error, refresh } = useResource(() => systemApi.get(), [])
  const [draft, setDraft] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)

  const saved = data?.rpcTimeoutSec ?? 0
  const pending = draft ?? saved
  const dirty = draft !== null && draft !== saved

  const save = async () => {
    setSaving(true)
    try {
      const applied = await systemApi.setRpcTimeout(pending)
      setDraft(null)
      refresh()
      message.success(`RPC 超时已设为 ${applied} 秒，下一个请求就用它`)
    } catch (e) {
      message.error((e as Error).message || '保存失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <PageShell
      title="系统设置"
      description="控制台自身的运行参数，对所有集群生效。"
      icon={<SettingOutlined />}
      namespaced={false}
      error={error}
    >
      <div className="max-w-[640px] py-3">
        <Typography.Title level={5} style={{ margin: 0, color: '#15233a' }}>
          Agent 响应超时
        </Typography.Title>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          控制台把请求发给集群里的 Agent 之后，等回执的秒数。到点就报「Agent 未在 N 秒内回执」并中断这次操作。
          集群大、apiserver 慢就调大一些；调小只是早点报错，Agent 那边已经收到的操作照样会执行完。
        </Typography.Text>

        <div className="mt-4 flex items-center gap-3">
          <InputNumber
            min={data?.min ?? 1}
            max={data?.max ?? 120}
            precision={0}
            value={draft ?? saved}
            onChange={(v) => setDraft(typeof v === 'number' ? v : null)}
            style={{ width: 120 }}
          />
          <span className="text-xs text-[#5c6b80]">秒</span>
          <Button type="primary" disabled={!dirty} loading={saving} onClick={save}>
            保存
          </Button>
          {dirty && <span className="text-xs text-[#8f9aa9]">当前生效 {saved} 秒</span>}
        </div>

        {!!data?.overrides.length && (
          <>
            <Divider style={{ margin: '20px 0 12px' }} />
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              下面这些接口扫描的对象多、本来就更慢，各自标了时限，不吃上面的设置：
            </Typography.Text>
            <div className="mt-3 flex flex-wrap gap-2">
              {data.overrides.map((o) => (
                <Tag key={o.method} variant="filled" className="!m-0">
                  {o.method} · {o.sec} 秒
                </Tag>
              ))}
            </div>
          </>
        )}
      </div>
    </PageShell>
  )
}
