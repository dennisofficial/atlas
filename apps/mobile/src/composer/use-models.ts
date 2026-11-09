import { useEffect, useState } from 'react'

import { useAuth } from '../auth/auth-provider'
import { type IModelOption, modelOptionsOf } from './model-options'

export const useModels = (): {
  models: readonly IModelOption[]
  ready: boolean
  failed: boolean
} => {
  const { api } = useAuth()
  const [models, setModels] = useState<readonly IModelOption[]>([])
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (api === undefined) return
    let cancelled = false
    void api.models.list
      .query()
      .then((response) => {
        if (cancelled) return
        setModels(modelOptionsOf(response))
        setReady(true)
      })
      .catch(() => {
        if (cancelled) return
        setFailed(true)
        setReady(true)
      })
    return () => {
      cancelled = true
    }
  }, [api])

  return { models, ready, failed }
}
