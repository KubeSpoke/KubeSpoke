import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { agentApi, clusterApi } from '../api/cluster'
import type { ClusterAgent } from '../types/dto'
import type { Namespace } from '../types/dto'

interface ClusterState {
  agents: ClusterAgent[]
  namespaces: Namespace[]
  cluster: string
  namespace: string
  loadingAgents: boolean
  loadAgents: () => Promise<void>
  loadNamespaces: () => Promise<void>
  setCluster: (cluster: string) => void
  setNamespace: (namespace: string) => void
}

export const useClusterStore = create<ClusterState>()(
  persist(
    (set, get) => ({
      agents: [],
      namespaces: [],
      cluster: '',
      namespace: 'default',
      loadingAgents: false,

      loadAgents: async () => {
        set({ loadingAgents: true })
        try {
          const agents = await agentApi.online()
          const list = agents ?? []
          const current = list.some((a) => a.name === get().cluster) ? get().cluster : (list[0]?.name ?? '')
          set({ agents: list, cluster: current, loadingAgents: false })
          if (current) await get().loadNamespaces()
        } catch {
          set({ agents: [], cluster: '', loadingAgents: false })
        }
      },

      loadNamespaces: async () => {
        const cluster = get().cluster
        if (!cluster) return
        try {
          const namespaces = await clusterApi.namespaces(cluster)
          set({ namespaces: namespaces ?? [] })
        } catch {
          set({ namespaces: [] })
        }
      },

      setCluster: (cluster) => {
        set({ cluster, namespace: 'default', namespaces: [] })
        void get().loadNamespaces()
      },

      setNamespace: (namespace) => set({ namespace }),
    }),
    { name: 'kubespoke-cluster', partialize: (s) => ({ cluster: s.cluster, namespace: s.namespace }) },
  ),
)
