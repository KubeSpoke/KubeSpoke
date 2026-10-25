/** 单个数据文件上限：ConfigMap 整体受 etcd 请求体限制，1Mi 已够配置文件用 */
const MAX_BYTES = 1024 * 1024

export type ImportedRow = { key: string; value: string } | { error: string }

/** 读文本文件为一条数据项（键＝文件名，自动避让已有键）；二进制/超限文件返回错误说明 */
export async function importDataFiles(file: File, usedKeys: string[] = []): Promise<ImportedRow> {
  const name = freeKey(safeName(file.name), usedKeys)
  if (file.size > MAX_BYTES) return { error: `${name} 超过 1 MB` }
  const buffer = await file.arrayBuffer()
  if (new Uint8Array(buffer).some((b) => b === 0)) return { error: `${name} 是二进制文件` }
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buffer)
  } catch {
    return { error: `${name} 不是 UTF-8 文本` }
  }
  return { key: name, value: text }
}

/** 去掉路径与首尾空白：浏览器已给裸文件名，这里只兜底异常输入 */
function safeName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? ''
  return base.trim() || 'data'
}

/** data 与 binaryData 共用一个键空间，导入时自动避让已有键 */
function freeKey(key: string, usedKeys: string[]): string {
  const used = new Set(usedKeys)
  if (!used.has(key)) return key
  const dot = key.lastIndexOf('.')
  const stem = dot > 0 ? key.slice(0, dot) : key
  const ext = dot > 0 ? key.slice(dot) : ''
  for (let i = 1; ; i += 1) {
    const candidate = `${stem}-${i}${ext}`
    if (!used.has(candidate)) return candidate
  }
}
