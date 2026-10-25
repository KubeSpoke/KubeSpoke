export interface ClusterAgent {
  identity: string
  name: string
}

export interface Namespace {
  name: string
  creationTime?: string
}

export interface Deployment {
  name: string
  namespace: string
  labels?: Record<string, string>
  annotations?: Record<string, string>
  creationTime?: string
  images?: string[]
  status?: { readyReplicas: number; replicas: number }
}

export interface Service {
  name: string
  namespace: string
  type: string
  clusterIPs?: string[]
  externalIPs?: string[]
  labels?: Record<string, string>
  creationTime?: string
  ports?: { port: number; protocol?: string; nodePort?: number; name?: string; targetPort?: string }[]
}

export interface Secret {
  name: string
  namespace: string
  type: string
  creationTime?: string
  data?: Record<string, string>
}

export interface Ingress {
  name: string
  namespace: string
  creationTime?: string
  labels?: Record<string, string>
  annotations?: Record<string, string>
  rules?: { host?: string; http?: { paths?: { path?: string; pathType?: string; backend?: { service?: { name?: string; port?: { number?: number } } } }[] } }[]
}

export interface CanaryApp {
  name: string
  namespace: string
  weight?: number
  image?: string
  service?: string
  deployment?: string
}

/** 镜像仓库的 tag 清单；字段是 camelCase（服务端 MVC 的序列化口径） */
export interface ImageTags {
  registry: string
  repository: string
  tags: string[]
  /** 凭证来源：anonymous 或 secret:命名空间/名称 */
  credential: string
  /** 拉不到或只列了前 N 个的说明，正常为空串 */
  notice: string
}
