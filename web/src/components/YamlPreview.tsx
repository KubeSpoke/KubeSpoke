import { Collapse } from 'antd'
import { toYaml } from '../utils/yaml'

interface Props {
  value: unknown
  label?: string
  maxHeight?: number
}

/** 把即将提交的对象原样打成 YAML 供确认，纯展示，不参与提交 */
export function YamlPreview({ value, label = '提交内容预览', maxHeight = 260 }: Props) {
  return (
    <Collapse
      size="small"
      className="mt-4"
      items={[
        {
          key: 'yaml',
          label,
          children: (
            <pre
              className="kbd-mono m-0 overflow-auto rounded bg-[var(--ks-fill-soft)] p-3 text-xs"
              style={{ maxHeight }}
            >
              {toYaml(value)}
            </pre>
          ),
        },
      ]}
    />
  )
}
