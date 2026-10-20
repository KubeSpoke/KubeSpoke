import { CloseOutlined, LeftOutlined, RightOutlined } from '@ant-design/icons'
import { Button, Modal, Switch } from 'antd'
import type { ModalProps } from 'antd'
import type { ReactNode } from 'react'

type Props = Omit<ModalProps, 'footer' | 'closable' | 'closeIcon' | 'title' | 'onCancel' | 'onOk'> & {
  title: ReactNode
  onCancel?: () => void
  onOk?: () => void
  /** 步骤标题；传入即进入分步向导模式 */
  steps?: string[]
  /** 当前步骤下标（分步模式必填） */
  current?: number
  onStepClick?: (i: number) => void
  onNext?: () => void
  onPrev?: () => void
  nextText?: string
  /** 是否在头部显示「编辑 YAML」开关（KubeSphere 弹窗右上角） */
  showYamlToggle?: boolean
  onYamlToggle?: (on: boolean) => void
  yamlOn?: boolean
}

/**
 * 1:1 复刻 KubeSphere「创建」弹窗：宽居中 Modal + 自定义头部（左标题、右「编辑 YAML」开关 + 深色方块关闭）
 * + 步骤条 + 页脚（取消 / 上一步 / 下一步 / 确定深藏青）。传 steps+current 即真实分步向导。
 */
export function KsCreateModal({
  title,
  steps,
  current,
  onStepClick,
  onNext,
  onPrev,
  nextText = '下一步',
  showYamlToggle = true,
  onYamlToggle,
  yamlOn,
  onCancel,
  onOk,
  okText = '确定',
  okButtonProps,
  width = 1000,
  children,
  ...rest
}: Props) {
  const close = () => onCancel?.()
  const wizard = !!steps && steps.length > 0 && current != null
  const last = wizard ? steps!.length - 1 : 0
  const atLast = !wizard || current === last

  return (
    <Modal
      open
      width={width}
      centered
      closable={false}
      closeIcon={null}
      footer={null}
      destroyOnHidden
      {...rest}
      styles={{ body: { padding: 0 } }}
      onCancel={close}
    >
      {/* 头部 */}
      <div className="flex items-center justify-between border-b border-[#ebeef2] px-6" style={{ height: 56 }}>
        <span style={{ fontSize: 16, fontWeight: 700, color: '#222b45' }}>{title}</span>
        <div className="flex items-center gap-4">
          {showYamlToggle && (
            <span className="inline-flex items-center gap-2 text-[13px] text-[#454f5c]">
              编辑 YAML
              <Switch size="small" checked={yamlOn} onChange={(v) => onYamlToggle?.(v)} />
            </span>
          )}
          <button
            onClick={close}
            className="grid size-7 place-items-center rounded bg-[#242e42] text-white transition-colors hover:bg-[#324259]"
            aria-label="关闭"
          >
            <CloseOutlined style={{ fontSize: 13 }} />
          </button>
        </div>
      </div>

      {/* 步骤条 */}
      {wizard && (
        <div className="flex items-center gap-10 border-b border-[#ebeef2] bg-[#eef4f8] px-6 py-3">
          {steps!.map((s, i) => {
            const done = i < current!
            const active = i === current!
            return (
              <button
                key={s}
                type="button"
                disabled={!onStepClick}
                onClick={() => onStepClick?.(i)}
                className="flex items-center gap-2"
                style={{ background: 'none', border: 'none', padding: 0, cursor: onStepClick ? 'pointer' : 'default' }}
              >
                <span
                  className="grid size-5 place-items-center rounded-full text-[12px] font-medium text-white"
                  style={{ background: done || active ? '#29b6a9' : '#b6bfcc' }}
                >
                  {i + 1}
                </span>
                <span style={{ fontSize: 13, fontWeight: active ? 600 : 400, color: active ? '#222b45' : done ? '#29b6a9' : '#7a8798' }}>
                  {s}
                </span>
              </button>
            )
          })}
        </div>
      )}

      {/* 内容 */}
      <div className="max-h-[62vh] overflow-auto px-8 py-6">{children}</div>

      {/* 页脚 */}
      <div className="flex items-center justify-end gap-3 border-t border-[#ebeef2] px-6" style={{ height: 64 }}>
        <Button onClick={close} style={{ borderRadius: 6, height: 34, paddingInline: 22 }}>
          取消
        </Button>
        {wizard && current! > 0 && (
          <Button icon={<LeftOutlined />} iconPosition="end" onClick={onPrev} style={{ borderRadius: 6, height: 34, paddingInline: 18 }}>
            上一步
          </Button>
        )}
        {wizard && !atLast ? (
          <Button type="primary" onClick={onNext} style={{ borderRadius: 6, height: 34, paddingInline: 22 }}>
            {nextText}
            <RightOutlined style={{ fontSize: 11 }} />
          </Button>
        ) : (
          <Button
            type="primary"
            onClick={onOk}
            loading={okButtonProps?.loading}
            disabled={okButtonProps?.disabled}
            style={{ borderRadius: 6, height: 34, paddingInline: 22 }}
          >
            {okText}
          </Button>
        )}
      </div>
    </Modal>
  )
}

export default KsCreateModal
