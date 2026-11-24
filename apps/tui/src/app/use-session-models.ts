import { useCallback, useEffect, useRef, useState } from 'react'

import type { CatalogueProvider } from '@dltech/atlas-models'

import { providerNamesOf, providersOf, reachableOf } from './models-catalogue'
import type { ModelsReply, SessionApi } from './session-api'

export type SessionModels = {
  providers: readonly CatalogueProvider[]
  reachable: ReadonlySet<string>
  names: Readonly<Record<string, string>>
  ready: boolean
  failed: boolean
  reload: () => void
}

const NO_PROVIDERS: readonly CatalogueProvider[] = []

const NO_REACHABLE: ReadonlySet<string> = new Set()

const NO_NAMES: Readonly<Record<string, string>> = {}

const NO_MODELS: SessionModels = {
  providers: NO_PROVIDERS,
  reachable: NO_REACHABLE,
  names: NO_NAMES,
  ready: false,
  failed: false,
  reload: () => undefined,
}

const messageOf = (failure: unknown): string =>
  failure instanceof Error ? failure.message : String(failure)

export function useSessionModels(args: {
  api: SessionApi | null
  onProblem: (reason: string) => void
}): SessionModels {
  const [models, setModels] = useState<ModelsReply | null>(null)
  const [failed, setFailed] = useState(false)
  const [version, setVersion] = useState(0)
  const problem = useRef(args.onProblem)
  problem.current = args.onProblem
  const { api } = args

  useEffect(() => {
    if (api === null) return undefined

    let cancelled = false
    setFailed(false)
    void api.listModels().then(
      (next) => {
        if (!cancelled) setModels(next)
      },
      (failure) => {
        if (cancelled) return
        setFailed(true)
        problem.current(`could not load the models — ${messageOf(failure)}`)
      },
    )

    return () => {
      cancelled = true
    }
  }, [api, version])

  const reload = useCallback(() => setVersion((current) => current + 1), [])

  if (models === null)
    return failed ? { ...NO_MODELS, failed: true, reload } : { ...NO_MODELS, reload }

  return {
    reload,
    providers: providersOf({ models }),
    reachable: reachableOf({ models }),
    names: providerNamesOf({ models }),
    ready: true,
    failed,
  }
}
