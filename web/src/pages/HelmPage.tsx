import { useNavigate, useParams } from 'react-router-dom'
import { Tabs } from 'antd'
import { useState } from 'react'
import { helmApi } from '../api/helm'
import { clusterPath } from '../config/nav'
import { useResource } from '../hooks/useResource'
import { useClusterStore } from '../store/useClusterStore'
import MarketTab from './helm/MarketTab'
import ReleasesTab from './helm/ReleasesTab'
import ReposTab from './helm/ReposTab'

/** key 进路由（helm/<tab>），market 是默认页不占一段 */
const TABS = [
  { key: 'market', label: '应用市场' },
  { key: 'releases', label: '已安装应用' },
  { key: 'repos', label: 'Chart 仓库' },
]

export default function HelmPage() {
  const navigate = useNavigate()
  const cluster = useClusterStore((s) => s.cluster)
  const { tab: tabParam } = useParams<{ tab?: string }>()
  const tab = TABS.some((t) => t.key === tabParam) ? tabParam! : 'market'

  const go = (key: string) => navigate(clusterPath(cluster, key === 'market' ? 'helm' : `helm/${key}`))

  // 仓库列表三个页签都要用（市场选仓库、升级选来源、仓库页自己增删），所以只在这一层取一次
  const repos = useResource(() => helmApi.repos(), [])
  // 只有已安装应用这页需要 agent 自检，逛市场不必为它等一次 RPC
  const capability = useResource(
    () => (cluster && tab === 'releases' ? helmApi.capability(cluster).catch(() => undefined) : Promise.resolve(undefined)),
    [cluster, tab],
  )

  const [repoId, setRepoId] = useState<number>()
  const rows = repos.data?.items ?? []
  // 没手动选过就落在第一个仓库上，省一次 setState
  const activeRepoId = repoId ?? rows[0]?.id

  return (
    // 紧凑布局：Tab 条与内容是同一张卡的两段，中间不再插一张白卡和一份间距
    <div className="ks-panel overflow-hidden">
      <Tabs activeKey={tab} onChange={go} items={TABS} className="ks-tabs pt-1" />

      {tab === 'market' && (
        <MarketTab
          cluster={cluster}
          repos={rows}
          repoId={activeRepoId}
          onRepoChange={setRepoId}
          onManageRepos={() => go('repos')}
          onInstalled={() => go('releases')}
        />
      )}
      {tab === 'releases' && (
        <ReleasesTab
          cluster={cluster}
          repos={rows}
          capability={capability.data}
          onMarket={() => go('market')}
        />
      )}
      {tab === 'repos' && (
        <ReposTab
          repos={rows}
          loading={repos.loading}
          error={repos.error}
          onRefresh={repos.refresh}
          onPick={(id) => {
            setRepoId(id)
            go('market')
          }}
        />
      )}
    </div>
  )
}
