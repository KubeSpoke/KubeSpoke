import { HubConnectionBuilder } from '@microsoft/signalr'
import { App, Button, Empty, Switch, Typography } from 'antd'
import { useEffect, useRef, useState } from 'react'
import { clusterApi } from '../api/cluster'

const MAX_LINES = 3000

/**
 * Pod 容器日志实时流（SignalR /pod-log），从 LogsPage 抽出，供「日志」标签页复用。
 * cluster/namespace/pod 任一变化即重连。
 */
export function PodLogStream({ cluster, namespace, pod }: { cluster: string; namespace: string; pod: string }) {
  const { message } = App.useApp()
  const [lines, setLines] = useState<string[]>([])
  const [connected, setConnected] = useState(false)
  const [follow, setFollow] = useState(true)
  const [autoScroll, setAutoScroll] = useState(true)
  const boxRef = useRef<HTMLPreElement>(null)
  const stoppedRef = useRef(false)

  useEffect(() => {
    if (!cluster || !pod) return
    stoppedRef.current = false
    setLines([])
    const conn = new HubConnectionBuilder()
      .withUrl(clusterApi.logHubUrl(cluster, namespace, pod))
      .withAutomaticReconnect()
      .build()

    conn.on('LogWrite', (line: string) => {
      if (stoppedRef.current) return
      setLines((prev) => (prev.length > MAX_LINES ? [...prev.slice(prev.length - MAX_LINES), line] : [...prev, line]))
    })
    conn.onclose(() => setConnected(false))

    conn
      .start()
      .then(() => setConnected(true))
      .catch((e: Error) => message.error(`日志连接失败：${e.message}`))

    return () => {
      stoppedRef.current = true
      void conn.stop()
      setConnected(false)
    }
  }, [cluster, namespace, pod, follow, message])

  useEffect(() => {
    if (autoScroll && boxRef.current) boxRef.current.scrollTop = boxRef.current.scrollHeight
  }, [lines, autoScroll])

  if (!pod) return <Empty description="缺少 Pod 名称" image={Empty.PRESENTED_IMAGE_SIMPLE} />

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <Typography.Text type="secondary" className="!text-xs">
          {connected ? '实时推送中' : '未连接'} · {lines.length} 行
        </Typography.Text>
        <span className="inline-flex items-center gap-3">
          <Switch size="small" checkedChildren="续流" unCheckedChildren="暂停" checked={follow} onChange={setFollow} />
          <Switch size="small" checkedChildren="置顶底部" unCheckedChildren="手动" checked={autoScroll} onChange={setAutoScroll} />
          <Button size="small" onClick={() => { navigator.clipboard.writeText(lines.join('\n')); message.success('已复制') }}>
            复制
          </Button>
        </span>
      </div>
      <pre ref={boxRef} className="log-stream max-h-[52vh] min-h-[300px] overflow-auto rounded-md p-4">
        {lines.length ? lines.join('\n') : '等待日志输出…'}
      </pre>
    </div>
  )
}

export default PodLogStream
