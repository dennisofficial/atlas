import { useCallback, useEffect, useState } from 'react'

import type { DeclaredServicesView, ThreadId } from '@dltech/atlas-core'
import { EEnsureStatus, EKilledBy } from '@dltech/atlas-harness'

import type { AtlasApp } from './compose'

const FAILED_ENSURES = new Set([
  EEnsureStatus.Failed,
  EEnsureStatus.CrashLooping,
  EEnsureStatus.Invalid,
  EEnsureStatus.Unknown,
])

const reasonOf = (error: unknown): string =>
  error instanceof Error && error.message !== '' ? error.message : 'the request failed'

export type DeclaredServicesControl = {
  declared: DeclaredServicesView | null
  notice: string | null
  handleStart: (name: string) => void
  handleRestart: (serviceId: string) => void
  handleStop: (serviceId: string) => void
  handleClearNotice: () => void
}

export function useDeclaredServices(args: {
  app: AtlasApp
  threadId: ThreadId
}): DeclaredServicesControl {
  const { app, threadId } = args
  const [declared, setDeclared] = useState<DeclaredServicesView | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const refresh = useCallback(async (): Promise<void> => {
    const latest = await Promise.resolve(app.services.declared?.()).catch(() => undefined)
    if (latest === undefined) return
    setDeclared((current) =>
      JSON.stringify(current) === JSON.stringify(latest) ? current : latest,
    )
  }, [app])

  useEffect(() => {
    void refresh()
    return app.services.subscribe(() => void refresh())
  }, [app, refresh])

  const handleClearNotice = useCallback(() => setNotice(null), [])

  const settle = useCallback(
    (failure: string | undefined): void => {
      setNotice((current) => (current === (failure ?? null) ? current : (failure ?? null)))
      void refresh()
    },
    [refresh],
  )

  const handleStart = useCallback(
    (name: string) => {
      const ensure = app.services.ensureDeclared
      if (ensure === undefined) {
        settle('start unavailable')
        return
      }
      void ensure
        .call(app.services, { threadId, names: [name] })
        .then((results) => {
          const failed = results.find((one) => FAILED_ENSURES.has(one.status))
          settle(
            failed === undefined ? undefined : `${failed.name}: ${failed.reason ?? failed.status}`,
          )
        })
        .catch((error: unknown) => settle(`${name}: ${reasonOf(error)}`))
    },
    [app, settle, threadId],
  )

  const handleRestart = useCallback(
    (serviceId: string) => {
      const restart = app.services.restart
      if (restart === undefined) {
        settle('restart unavailable')
        return
      }
      void restart
        .call(app.services, { serviceId })
        .then((outcome) => settle(outcome.ok ? undefined : outcome.reason))
        .catch((error: unknown) => settle(reasonOf(error)))
    },
    [app, settle],
  )

  const handleStop = useCallback(
    (serviceId: string) => {
      void Promise.resolve(app.services.stop({ serviceId, by: EKilledBy.User }))
        .then((outcome) => settle(outcome.ok ? undefined : outcome.reason))
        .catch((error: unknown) => settle(reasonOf(error)))
    },
    [app, settle],
  )

  return { declared, notice, handleStart, handleRestart, handleStop, handleClearNotice }
}
