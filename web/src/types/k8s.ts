export interface ObjectMeta {
  name?: string
  namespace?: string
  uid?: string
  resourceVersion?: string
  creationTimestamp?: string
  labels?: Record<string, string>
  annotations?: Record<string, string>
  deletionTimestamp?: string
}

export interface Condition {
  type?: string
  status?: string
  reason?: string
  message?: string
  lastTransitionTime?: string
  lastHeartbeatTime?: string
}

export interface V1Pod {
  metadata?: ObjectMeta
  spec?: {
    nodeName?: string
    containers?: { name: string; image: string; ports?: { containerPort?: number }[] }[]
    restartPolicy?: string
  }
  status?: {
    phase?: string
    podIP?: string
    hostIP?: string
    startTime?: string
    conditions?: Condition[]
    containerStatuses?: {
      name: string
      ready: boolean
      restartCount: number
      image: string
      state?: Record<string, { reason?: string }>
    }[]
  }
}

export interface V1Node {
  metadata?: ObjectMeta
  spec?: { unschedulable?: boolean }
  status?: {
    addresses?: { type: string; address: string }[]
    capacity?: Record<string, string>
    allocatable?: Record<string, string>
    conditions?: Condition[]
    nodeInfo?: {
      kubeletVersion?: string
      osImage?: string
      containerRuntimeVersion?: string
      architecture?: string
    }
    images?: { names?: string[]; sizeBytes?: number }[]
  }
}

export interface V1Deployment {
  metadata?: ObjectMeta
  spec?: { replicas?: number; template?: { spec?: { containers?: { name: string; image: string }[] } } }
  status?: { replicas?: number; readyReplicas?: number; availableReplicas?: number; updatedReplicas?: number }
}

export interface V1Service {
  metadata?: ObjectMeta
  spec?: { type?: string; clusterIP?: string; ports?: { port?: number; targetPort?: string; nodePort?: number; protocol?: string; name?: string }[] }
}

export interface V1Ingress {
  metadata?: ObjectMeta
  spec?: {
    ingressClassName?: string
    rules?: { host?: string; http?: { paths?: { path?: string; pathType?: string; backend?: { service?: { name?: string; port?: { number?: number } } } }[] } }[]
    tls?: { hosts?: string[]; secretName?: string }[]
  }
  status?: { loadBalancer?: { ingress?: { ip?: string; hostname?: string }[] } }
}

export interface V1IngressClass {
  metadata?: ObjectMeta
  spec?: { controller?: string; parameters?: Record<string, unknown> }
}

/** Secret 的 data 是 byte[]，System.Text.Json 打成 base64 字符串 */
export interface V1Secret {
  metadata?: ObjectMeta
  type?: string
  data?: Record<string, string>
}

export interface V1ConfigMap {
  metadata?: ObjectMeta
  data?: Record<string, string>
  binaryData?: Record<string, string>
}

export interface V1PersistentVolumeClaim {
  metadata?: ObjectMeta
  spec?: { accessModes?: string[]; resources?: { requests?: Record<string, string> }; storageClassName?: string; volumeName?: string }
  status?: { phase?: string; capacity?: Record<string, string> }
}

export interface V1PersistentVolume {
  metadata?: ObjectMeta
  spec?: { capacity?: Record<string, string>; accessModes?: string[]; storageClassName?: string; claimRef?: { namespace?: string; name?: string } }
  status?: { phase?: string }
}

export interface V1StorageClass {
  metadata?: ObjectMeta
  provisioner?: string
  reclaimPolicy?: string
  volumeBindingMode?: string
}

export interface V1Event {
  metadata?: ObjectMeta
  involvedObject?: { kind?: string; namespace?: string; name?: string }
  reason?: string
  message?: string
  type?: string
  count?: number
  firstTimestamp?: string
  lastTimestamp?: string
}

export interface V1ReplicaSet {
  metadata?: ObjectMeta
  spec?: { replicas?: number }
  status?: { readyReplicas?: number }
}

export interface V1Scale {
  metadata?: ObjectMeta
  spec?: { replicas?: number }
  status?: { replicas?: number; selector?: { matchLabels?: Record<string, string> } }
}

/** metrics-server 原始对象，usage 为 { cpu: '123456n', memory: '123456789' } */
export interface Metrics {
  metadata?: ObjectMeta
  timestamp?: string
  window?: string
  usage?: Record<string, string | number>
}
