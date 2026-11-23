import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { SessionApi } from './session-api'

export type SecretControl = {
  present: (name: string) => boolean
  refresh: () => void
  save: (args: { name: string; value: string }) => Promise<boolean>
  clear: (name: string) => Promise<boolean>
}

const messageOf = (failure: unknown): string =>
  failure instanceof Error ? failure.message : String(failure)

export const SECRET_SET = '(set)'

const NO_NAMES: ReadonlySet<string> = new Set()

export function useSecrets(args: {
  api: SessionApi | null
  onProblem: (reason: string) => void
}): SecretControl {
  const { api } = args
  const [names, setNames] = useState<ReadonlySet<string>>(NO_NAMES)
  const [reads, setReads] = useState(0)
  const namesRef = useRef(names)
  namesRef.current = names
  const problem = useRef(args.onProblem)
  problem.current = args.onProblem

  useEffect(() => {
    if (api === null) return undefined

    let cancelled = false
    void api.secretNames().then(
      (found) => {
        if (!cancelled) setNames(new Set(found))
      },
      (failure) => {
        if (!cancelled) problem.current(`could not read your secrets — ${messageOf(failure)}`)
      },
    )

    return () => {
      cancelled = true
    }
  }, [api, reads])

  const refresh = useCallback(() => setReads((read) => read + 1), [])

  const present = useCallback((name: string): boolean => namesRef.current.has(name), [])

  const save = useCallback(
    async (write: { name: string; value: string }): Promise<boolean> => {
      if (api === null) return false
      try {
        await api.putSecret({ name: write.name, value: write.value })
      } catch (failure) {
        problem.current(`could not save the secret — ${messageOf(failure)}`)
        return false
      }
      refresh()
      return true
    },
    [api, refresh],
  )

  const clear = useCallback(
    async (name: string): Promise<boolean> => {
      if (api === null) return false
      try {
        await api.removeSecret({ name })
      } catch (failure) {
        problem.current(`could not remove the secret — ${messageOf(failure)}`)
        return false
      }
      refresh()
      return true
    },
    [api, refresh],
  )

  return useMemo(() => ({ present, refresh, save, clear }), [clear, present, refresh, save])
}
