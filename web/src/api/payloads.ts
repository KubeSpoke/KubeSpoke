/**
 * 手动创建资源的请求体构建。放在不依赖 React 的模块里，表单值和线上字节都能单独验证。
 *
 * 大小写规则（System.Text.Json 区分大小写、无命名策略，写错不报错只静默丢字段）：
 * 外层 Contracts 手写 DTO 用 PascalCase，嵌套 k8s.Models 用 camelCase。
 */
import type {
  CreateConfigMapPayload,
  CreateDeploymentPayload,
  CreateDockerSecretPayload,
  CreateIngressPayload,
  CreatePvcPayload,
  CreateServicePayload,
  CreateTlsSecretPayload,
  EnvFromIn,
  EnvVarIn,
  IngressRuleIn,
  VolumeIn,
} from '../types/create'

type Ctx = { cluster: string; namespace: string }

/** 标签行（各创建表单共用；Deployment 用 PascalCase LabelRows，其余用同名，形状一致） */
export interface LabelRowIn {
  key?: string
  value?: string
}

/** {key,value}[] → Record，去空键、去保留键（如 Service/Deployment 的 app）；空则 undefined */
function labelsFromRows(rows: LabelRowIn[] | undefined, reserved: string[] = []): Record<string, string> | undefined {
  const map: Record<string, string> = {}
  for (const l of rows ?? []) {
    const k = l?.key?.trim()
    if (!k || reserved.includes(k)) continue
    map[k] = l.value ?? ''
  }
  return Object.keys(map).length ? map : undefined
}

/** 描述非空时打成 kubesphere.io/description 注解对象，否则 undefined */
function descAnnotation(desc: string | undefined): Record<string, string> | undefined {
  const d = desc?.trim()
  return d ? { 'kubesphere.io/description': d } : undefined
}

/* ---------------- Deployment ---------------- */

type EnvKind = 'literal' | 'cm'

export interface EnvRowIn {
  kind?: EnvKind
  name?: string
  value?: string
  cmName?: string
  cmKey?: string
}

export type MountSource = 'host' | 'pvc'

export interface MountRowIn {
  name?: string
  mountPath?: string
  source?: MountSource
  hostPath?: string
  claimName?: string
}

export interface ContainerForm {
  ContainerName?: string
  Image?: string
  ContainerPort?: number
  HostPort?: number | null
  Env?: EnvRowIn[]
  envFromCms?: string[]
  envFromSecrets?: string[]
  Mounts?: MountRowIn[]
}

export interface DeploymentFormValues {
  Name?: string
  Replicas?: number
  ImagePullSecrets?: string[]
  Containers?: ContainerForm[]
  Description?: string
  LabelRows?: LabelRowIn[]
}

const mountSig = (m: MountRowIn) => (m.source === 'pvc' ? `pvc:${m.claimName ?? ''}` : `host:${m.hostPath ?? ''}`)

/** 同名卷必须同源，否则下面只会取第一条来源，用户以为挂了两份 */
export function deploymentVolumeConflict(containers: ContainerForm[] | undefined): string {
  const seen = new Map<string, string>()
  for (const c of containers ?? []) {
    for (const m of c?.Mounts ?? []) {
      if (!m?.name) continue
      const sig = mountSig(m)
      const prev = seen.get(m.name)
      if (prev && prev !== sig) return `卷「${m.name}」在不同挂载里来源不一致，同名卷必须指向同一个目录或同一个 PVC`
      seen.set(m.name, sig)
    }
  }
  return ''
}

export function buildDeploymentPayload(
  values: DeploymentFormValues,
  ctx: Ctx,
): CreateDeploymentPayload {
  const perContainer = (values.Containers ?? []).map((c) => {
    const env: EnvVarIn[] = (c.Env ?? [])
      .filter((e) => e?.name)
      .map((e) =>
        e.kind === 'cm'
          ? { name: e.name ?? '', valueFrom: { configMapKeyRef: { name: e.cmName ?? '', key: e.cmKey ?? '' } } }
          : { name: e.name ?? '', value: e.value ?? '' },
      )
    const envFrom: EnvFromIn[] = [
      ...(c.envFromCms ?? []).map((name) => ({ configMapRef: { name } })),
      ...(c.envFromSecrets ?? []).map((name) => ({ secretRef: { name } })),
    ]
    const mounts = (c.Mounts ?? [])
      .filter((m) => m?.name && m?.mountPath)
      .map((m) => ({ name: m.name ?? '', mountPath: m.mountPath ?? '' }))
    return { c, env, envFrom, mounts }
  })

  const volumes: VolumeIn[] = []
  const pushed = new Set<string>()
  for (const { c } of perContainer) {
    for (const m of c.Mounts ?? []) {
      if (!m?.name || pushed.has(m.name)) continue
      pushed.add(m.name)
      volumes.push(
        m.source === 'pvc'
          ? { name: m.name, persistentVolumeClaim: { claimName: m.claimName ?? '' } }
          : { name: m.name, hostPath: { path: m.hostPath ?? '', type: 'DirectoryOrCreate' } },
      )
    }
  }

  const labels = labelsFromRows(values.LabelRows, ['app'])
  const description = values.Description?.trim()

  return {
    ClustName: ctx.cluster,
    Name: values.Name ?? '',
    Namespace: ctx.namespace,
    Replicas: values.Replicas ?? 1,
    Containers: perContainer.map(({ c, env, envFrom, mounts }) => ({
      ContainerName: c.ContainerName ?? '',
      Image: c.Image ?? '',
      ContainerPort: c.ContainerPort ?? 80,
      ...(c.HostPort ? { HostPort: c.HostPort } : {}),
      ...(env.length ? { Env: env } : {}),
      ...(envFrom.length ? { EnvFrom: envFrom } : {}),
      ...(mounts.length ? { VolumeMounts: mounts } : {}),
    })),
    ...(values.ImagePullSecrets?.length ? { ImagePullSecrets: values.ImagePullSecrets } : {}),
    ...(volumes.length ? { Volumes: volumes } : {}),
    ...(description ? { Description: description } : {}),
    ...(labels ? { Labels: labels } : {}),
  }
}

/* ---------------- Service ---------------- */

export interface ServiceFormValues {
  Name?: string
  AppName?: string
  Type?: string
  Port?: number
  Description?: string
  LabelRows?: LabelRowIn[]
}

/** 服务端把 AppName 同时写进 label 和 selector（app=<AppName>），Port 为 0 时回落成 80 */
export function buildServicePayload(values: ServiceFormValues, ctx: Ctx): CreateServicePayload {
  const name = values.Name?.trim() ?? ''
  const labels = labelsFromRows(values.LabelRows, ['app'])
  const description = values.Description?.trim()
  return {
    ClustName: ctx.cluster,
    Name: name,
    AppName: values.AppName?.trim() || name,
    Namespace: ctx.namespace,
    Type: values.Type === 'NodePort' ? 'NodePort' : 'ClusterIP',
    Port: values.Port && values.Port > 0 ? values.Port : 80,
    ...(description ? { Description: description } : {}),
    ...(labels ? { Labels: labels } : {}),
  }
}

/* ---------------- Ingress ---------------- */

export interface PathRow {
  path?: string
  pathType?: 'Prefix' | 'Exact' | 'ImplementationSpecific'
  service?: string
  port?: number
}

interface RuleRow {
  host?: string
  paths?: PathRow[]
}

interface TlsRow {
  hosts?: string[]
  secretName?: string
}

export interface IngressFormValues {
  Name?: string
  IngressClassName?: string
  Rules?: RuleRow[]
  Tls?: TlsRow[]
  Description?: string
  LabelRows?: LabelRowIn[]
}

/** 空规则 / 空后端 / 没填证书的条目直接丢弃，不发出 {} 脏数据 */
export function buildIngressPayload(values: IngressFormValues, ctx: Ctx): CreateIngressPayload {
  const rules: IngressRuleIn[] = (values.Rules ?? [])
    .map((rule) => {
      const paths = (rule.paths ?? [])
        .filter((p) => p?.service?.trim())
        .map((p) => ({
          path: p.path?.trim() || '/',
          pathType: p.pathType ?? 'Prefix',
          backend: {
            service: {
              name: p.service!.trim(),
              port: { number: p.port && p.port > 0 ? p.port : 80 },
            },
          },
        }))
      const host = rule.host?.trim()
      return { ...(host ? { host } : {}), http: { paths } }
    })
    .filter((r) => r.http.paths.length > 0)

  const tls = (values.Tls ?? [])
    .filter((t) => t?.secretName?.trim())
    .map((t) => ({
      hosts: (t.hosts ?? []).map((h) => h.trim()).filter(Boolean),
      secretName: t.secretName!.trim(),
    }))

  const className = values.IngressClassName?.trim()
  const labels = labelsFromRows(values.LabelRows)
  const description = values.Description?.trim()

  return {
    ClustName: ctx.cluster,
    Name: values.Name?.trim() ?? '',
    Namespace: ctx.namespace,
    ...(className ? { IngressClassName: className } : {}),
    ...(tls.length ? { Tls: tls } : {}),
    Rules: rules,
    ...(description ? { Description: description } : {}),
    ...(labels ? { Labels: labels } : {}),
  }
}

/* ---------------- ConfigMap ---------------- */

export interface ConfigMapRow {
  key?: string
  value?: string
}

export interface ConfigMapFormValues {
  name?: string
  items?: ConfigMapRow[]
  Description?: string
  LabelRows?: LabelRowIn[]
}

export function buildConfigMapPayload(
  values: ConfigMapFormValues,
  ctx: Ctx,
): CreateConfigMapPayload {
  const data: Record<string, string> = {}
  for (const row of values.items ?? []) {
    const key = row?.key?.trim()
    if (!key) continue
    data[key] = row.value ?? ''
  }
  const labels = labelsFromRows(values.LabelRows)
  const annotations = descAnnotation(values.Description)
  return {
    ClustName: ctx.cluster,
    Namespace: ctx.namespace,
    ConfigMap: {
      apiVersion: 'v1',
      kind: 'ConfigMap',
      metadata: {
        name: values.name?.trim() ?? '',
        namespace: ctx.namespace,
        ...(labels ? { labels } : {}),
        ...(annotations ? { annotations } : {}),
      },
      data,
    },
  }
}

/* ---------------- Secret ---------------- */

export interface SecretFormValues {
  name?: string
  domain?: string
  username?: string
  password?: string
  passphrase?: string
  Description?: string
  LabelRows?: LabelRowIn[]
}

/** Agent 据此自建 kubernetes.io/dockerconfigjson，前端不嵌套 k8s 对象 */
export function buildDockerSecretPayload(values: SecretFormValues, ctx: Ctx): CreateDockerSecretPayload {
  const labels = labelsFromRows(values.LabelRows)
  const description = values.Description?.trim()
  return {
    ClustName: ctx.cluster,
    Name: values.name?.trim() ?? '',
    Namespace: ctx.namespace,
    Domain: values.domain?.trim() ?? '',
    UserName: values.username ?? '',
    Password: values.password ?? '',
    ...(description ? { Description: description } : {}),
    ...(labels ? { Labels: labels } : {}),
  }
}

/** 注意是 PassWord（W 大写）；没填口令就省略该键，Agent 用 X509Certificate2 解析 PFX */
export function buildTlsSecretPayload(
  values: SecretFormValues,
  base64Pfx: string | undefined,
  ctx: Ctx,
): CreateTlsSecretPayload {
  const passphrase = values.passphrase?.trim()
  const labels = labelsFromRows(values.LabelRows)
  const description = values.Description?.trim()
  return {
    ClustName: ctx.cluster,
    Name: values.name?.trim() ?? '',
    Namespace: ctx.namespace,
    Base64PfxFile: base64Pfx ?? '',
    ...(passphrase ? { PassWord: values.passphrase } : {}),
    ...(description ? { Description: description } : {}),
    ...(labels ? { Labels: labels } : {}),
  }
}

/* ---------------- PVC ---------------- */

export interface PvcFormValues {
  name?: string
  capacity?: number
  unit?: string
  accessModes?: string[]
  storageClassName?: string
  volumeName?: string
  Description?: string
  LabelRows?: LabelRowIn[]
}

export function buildPvcPayload(values: PvcFormValues, ctx: Ctx): CreatePvcPayload {
  const storage = values.capacity === undefined ? '' : `${values.capacity}${values.unit ?? ''}`
  const storageClassName = values.storageClassName?.trim()
  const volumeName = values.volumeName?.trim()
  const labels = labelsFromRows(values.LabelRows)
  const annotations = descAnnotation(values.Description)
  return {
    ClustName: ctx.cluster,
    Pvc: {
      apiVersion: 'v1',
      kind: 'PersistentVolumeClaim',
      // Agent 读的是 request.Pvc.NamespaceOrDefault()，清单里不带命名空间会落到 default
      metadata: {
        name: values.name?.trim() ?? '',
        namespace: ctx.namespace,
        ...(labels ? { labels } : {}),
        ...(annotations ? { annotations } : {}),
      },
      spec: {
        accessModes: values.accessModes ?? [],
        ...(storageClassName ? { storageClassName } : {}),
        ...(volumeName ? { volumeName } : {}),
        resources: { requests: { storage } },
      },
    },
  }
}
