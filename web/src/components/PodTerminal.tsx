import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { App, Button, Select, Space, Typography } from 'antd'
import { useEffect, useRef, useState } from 'react'
import { HubConnectionBuilder } from '@microsoft/signalr'
import { clusterApi } from '../api/cluster'

/** 键盘输入要按 UTF-8 送进容器，btoa 只认 Latin-1，粘中文会直接抛异常 */
const encodeInput = (text: string) => {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary)
}

const decodeFrame = (frame: string) => {
  const binary = atob(frame)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/**
 * 容器终端（kubectl exec 的网页版）。输出走 base64 帧，键盘输入与尺寸变更直接发给 /pod-exec，
 * 由服务端转投该集群 agent 的连接。打开时的宽高随连接 URL 一起带过去，之后面板 resize 再补发；
 * 容器里的 PTY 拿不到宽高就按零宽折行，光标移动会乱。
 */
export function PodTerminal({
  cluster,
  namespace,
  pod,
  container,
  running,
}: {
  cluster: string
  namespace: string
  pod: string
  container: string
  running: boolean
}) {
  const { message } = App.useApp()
  const [command, setCommand] = useState('/bin/sh')
  const [open, setOpen] = useState(false)
  const [closed, setClosed] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open || !boxRef.current) return
    setClosed(false)

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 12,
      fontFamily: "ui-monospace, 'Cascadia Code', Menlo, Consolas, monospace",
      theme: { background: '#1e2a3a', foreground: '#cbd5e1' },
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(boxRef.current)
    fit.fit()

    const conn = new HubConnectionBuilder()
      .withUrl(clusterApi.execHubUrl(cluster, namespace, pod, container, command, term.cols, term.rows))
      .build()

    let hungUp = false
    conn.on('ExecOutput', (frame: string) => term.write(decodeFrame(frame)))
    conn.on('ExecClosed', () => {
      hungUp = true
      setClosed(true)
    })

    const write = (data: string) => {
      if (conn.state === 'Connected') void conn.send('Input', encodeInput(data)).catch(() => setClosed(true))
    }
    const inputDisposable = term.onData(write)
    const resizeDisposable = term.onResize(({ cols, rows }) => {
      if (conn.state === 'Connected' && !hungUp) void conn.send('Resize', cols, rows).catch(() => {})
    })

    conn
      .start()
      .then(() => term.focus())
      .catch((e: Error) => {
        message.error(`终端连接失败：${e.message}`)
        setClosed(true)
      })

    const onWindowResize = () => fit.fit()
    window.addEventListener('resize', onWindowResize)

    return () => {
      window.removeEventListener('resize', onWindowResize)
      inputDisposable.dispose()
      resizeDisposable.dispose()
      void conn.stop()
      term.dispose()
    }
  }, [open, cluster, namespace, pod, container, command, message])

  if (!running) {
    return <Typography.Text type="secondary">容器未在运行，无法打开终端。</Typography.Text>
  }

  return (
    <div>
      <Space size={8} className="mb-2">
        <Select
          size="small"
          value={command}
          onChange={setCommand}
          className="!w-32"
          options={[
            { value: '/bin/sh', label: '/bin/sh' },
            { value: '/bin/bash', label: '/bin/bash' },
          ]}
        />
        {open ? (
          <Button size="small" danger onClick={() => setOpen(false)}>
            断开
          </Button>
        ) : (
          <Button size="small" type="primary" onClick={() => setOpen(true)}>
            打开终端
          </Button>
        )}
        <Typography.Text type="secondary" className="!text-xs">
          {closed ? '会话已结束' : open ? '已连接' : '未连接'}
        </Typography.Text>
      </Space>
      <div ref={boxRef} className="pod-term w-full" />
    </div>
  )
}

export default PodTerminal
