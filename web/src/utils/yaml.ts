const INDENT = 2
const pad = (n: number) => ' '.repeat(n)

const keyName = (key: string) => (/^[A-Za-z_][\w.\-/]*$/.test(key) ? key : JSON.stringify(key))

const isList = (v: unknown): v is unknown[] => Array.isArray(v)
const isMap = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !isList(v)

const entriesOf = (value: Record<string, unknown>) =>
  Object.entries(value).filter(([, v]) => v !== undefined)

/** 空集合必须在调用方就地打成 [] / {}，否则 block() 会返回空串留下悬空写法 */
const emptyFlow = (value: unknown): string | null => {
  if (isList(value)) return value.length ? null : '[]'
  if (isMap(value)) return entriesOf(value).length ? null : '{}'
  return null
}

/** 字符串一律带引号输出，绕开冒号、#、前后空格这些 YAML 陷阱 */
const scalar = (v: unknown): string | null => {
  if (v === undefined || v === null) return 'null'
  if (typeof v === 'object') return null
  if (typeof v === 'string') return JSON.stringify(v)
  return String(v)
}

function blockString(key: string, value: string, indent: number): string {
  const clipped = value.endsWith('\n')
  const body = clipped ? value.slice(0, -1) : value
  if (!body.trim()) return `${pad(indent)}${key}: ${JSON.stringify(value)}\n`
  const lines = body
    .split('\n')
    .map((line) => (line ? pad(indent + INDENT) + line : ''))
    .join('\n')
  return `${pad(indent)}${key}: ${clipped ? '|' : '|-'}\n${lines}\n`
}

function block(value: unknown, indent: number): string {
  if (isList(value)) return value.map((item) => itemBlock(item, indent)).join('')
  return entriesOf(value as Record<string, unknown>)
    .map(([k, v]) => pair(k, v, indent))
    .join('')
}

function itemBlock(item: unknown, indent: number): string {
  const inline = scalar(item)
  if (inline !== null) return `${pad(indent)}- ${inline}\n`
  const flow = emptyFlow(item)
  if (flow) return `${pad(indent)}- ${flow}\n`
  return `${pad(indent)}- ${block(item, indent + INDENT).slice(pad(indent + INDENT).length)}`
}

function pair(key: string, value: unknown, indent: number): string {
  const k = keyName(key)
  if (typeof value === 'string' && value.includes('\n')) return blockString(k, value, indent)
  const inline = scalar(value)
  if (inline !== null) return `${pad(indent)}${k}: ${inline}\n`
  const flow = emptyFlow(value)
  if (flow) return `${pad(indent)}${k}: ${flow}\n`
  return `${pad(indent)}${k}:\n${block(value, indent + INDENT)}`
}

/** 只用于展示：把请求对象打成 YAML，标量带引号、多行走块标量。 */
export function toYaml(value: unknown): string {
  const flow = emptyFlow(value)
  if (flow) return flow
  if (!isMap(value) && !isList(value)) return scalar(value) ?? 'null'
  return block(value, 0).replace(/\n+$/, '')
}
