import { get, post } from './http'

/** 平台级设置里的一项：等 Agent 回执的时限 */
export interface SystemSettings {
  rpcTimeoutSec: number
  min: number
  max: number
  default: number
  /** 自带时限、不吃这项配置的接口 */
  overrides: { method: string; sec: number }[]
}

export const systemApi = {
  get: () => get<SystemSettings>('/Settings/Get'),
  setRpcTimeout: (sec: number) => post<number>(`/Settings/SetRpcTimeout?RpcTimeoutSec=${sec}`),
}
