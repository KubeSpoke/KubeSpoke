import { useCallback, useEffect, useRef, useState } from 'react'

interface Resource<T> {
  data: T | undefined
  error: string
  loading: boolean
  refresh: () => void
}

/** 极简数据加载：deps 变化即请求，refresh 手动重试 */
export function useResource<T>(loader: () => Promise<T>, deps: unknown[]): Resource<T> {
  const [data, setData] = useState<T>()
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const seq = useRef(0)

  const load = useCallback(() => {
    const id = ++seq.current
    setLoading(true)
    setError('')
    loader()
      .then((result) => {
        if (id === seq.current) setData(result)
      })
      .catch((e: Error) => {
        if (id === seq.current) setError(e.message)
      })
      .finally(() => {
        if (id === seq.current) setLoading(false)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  useEffect(() => {
    load()
  }, [load])

  return { data, error, loading, refresh: load }
}
