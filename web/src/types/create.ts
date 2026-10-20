/**
 * 手动创建资源时的请求体形状，必须和 `/api/Cluster/{Create*}` 两端的契约完全一致。
 *
 * System.Text.Json 大小写敏感且没有配 CamelCase 策略，所以：
 * - 外层是 Contracts 里手写的 DTO，键保持 C# 属性名（PascalCase：ClustName / Containers / ImagePullSecrets）；
 * - 嵌套的是 k8s.Models 对象（V1EnvVar / V1Volume / V1IngressRule / V1ConfigMap…），
 *   它们带 [JsonPropertyName]，键必须用 camelCase（name / mountPath / hostPath / metadata）。
 * 写错大小写不会报错，只会被静默丢掉，创建出缺字段的东西。
 */

/** k8s.Models.V1EnvVar */
export interface EnvVarIn {
  name: string
  value?: string
  valueFrom?: {
    configMapKeyRef?: { name: string; key: string }
    secretKeyRef?: { name: string; key: string }
  }
}

/** k8s.Models.V1EnvFromSource */
export interface EnvFromIn {
  configMapRef?: { name: string }
  secretRef?: { name: string }
}

/** k8s.Models.V1VolumeMount */
export interface VolumeMountIn {
  name: string
  mountPath: string
  readOnly?: boolean
}

/** k8s.Models.V1Volume，目前只支持 hostPath 和 persistentVolumeClaim 两种来源 */
export interface VolumeIn {
  name: string
  hostPath?: { path: string; type?: string }
  persistentVolumeClaim?: { claimName: string }
}

export interface CreateDeploymentPayload {
  ClustName: string
  Name: string
  Namespace: string
  Replicas: number
  Containers: {
    ContainerName: string
    Image: string
    ContainerPort: number
    HostPort?: number | null
    Env?: EnvVarIn[]
    EnvFrom?: EnvFromIn[]
    VolumeMounts?: VolumeMountIn[]
  }[]
  ImagePullSecrets?: string[]
  Volumes?: VolumeIn[]
  /** 描述，写入 Deployment 注解 kubesphere.io/description */
  Description?: string
  /** 用户标签，合并进 Deployment 与 Pod 模板的 metadata.labels（app 键保留给选择器） */
  Labels?: Record<string, string>
}

export interface CreateServicePayload {
  ClustName: string
  Name: string
  /** 同时写进 Service 的 label 和 selector，需要与 Deployment 名一致才能选中后端 Pod */
  AppName: string
  Namespace: string
  Type: 'ClusterIP' | 'NodePort'
  Port: number
  Description?: string
  Labels?: Record<string, string>
}

/** k8s.Models.V1IngressRule */
export interface IngressRuleIn {
  host?: string
  http: {
    paths: {
      path: string
      pathType: 'Prefix' | 'Exact' | 'ImplementationSpecific'
      backend: { service: { name: string; port: { number: number } } }
    }[]
  }
}

export interface CreateIngressPayload {
  ClustName: string
  Name: string
  Namespace: string
  IngressClassName?: string
  Tls?: { hosts: string[]; secretName: string }[]
  Rules: IngressRuleIn[]
  Description?: string
  Labels?: Record<string, string>
}

export interface CreateConfigMapPayload {
  ClustName: string
  Namespace: string
  ConfigMap: {
    apiVersion: 'v1'
    kind: 'ConfigMap'
    metadata: { name: string; namespace?: string; labels?: Record<string, string>; annotations?: Record<string, string> }
    data: Record<string, string>
  }
}

export interface CreateDockerSecretPayload {
  ClustName: string
  Name: string
  Namespace: string
  Domain: string
  UserName: string
  Password: string
  Description?: string
  Labels?: Record<string, string>
}

export interface CreateTlsSecretPayload {
  ClustName: string
  Name: string
  Namespace: string
  /** .pfx 文件的 base64，Agent 侧用它导出 tls.crt / tls.key */
  Base64PfxFile: string
  PassWord?: string
  Description?: string
  Labels?: Record<string, string>
}

export interface CreatePvcPayload {
  ClustName: string
  Pvc: {
    apiVersion: 'v1'
    kind: 'PersistentVolumeClaim'
    metadata: { name: string; namespace?: string; labels?: Record<string, string>; annotations?: Record<string, string> }
    spec: {
      accessModes: string[]
      storageClassName?: string
      volumeName?: string
      resources: { requests: { storage: string } }
    }
  }
}
