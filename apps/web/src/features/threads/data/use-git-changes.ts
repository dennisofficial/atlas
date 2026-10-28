'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import type { ChangedFile } from '@dltech/atlas-ui/ai/changes-panel'
import type { EChangeScope } from '@dltech/atlas-wire/web'

import { loadGitChanges, messageOfFailure, type GitChangesChannel } from './git-changes-load'

export enum EGitChangesStatus {
  Loading = 'loading',
  Ready = 'ready',
  Failed = 'failed',
}

export type GitChangesView =
  | { status: EGitChangesStatus.Loading }
  | {
      status: EGitChangesStatus.Ready
      files: ChangedFile[]
      truncated: boolean
      ignored: string[]
    }
  | { status: EGitChangesStatus.Failed; message: string }

type Settled = { scope: EChangeScope; view: GitChangesView }

const LOADING: GitChangesView = { status: EGitChangesStatus.Loading }

export function useTurnEndCount(working: boolean): number {
  const [count, setCount] = useState(0)
  const wasWorking = useRef(working)

  useEffect(() => {
    if (wasWorking.current && !working) setCount((current) => current + 1)
    wasWorking.current = working
  }, [working])

  return count
}

export function useGitChanges(args: {
  channel: GitChangesChannel | null
  scope: EChangeScope
  working: boolean
}): { view: GitChangesView; reload: () => void } {
  const { channel, scope, working } = args
  const [settled, setSettled] = useState<Settled | null>(null)
  const [reloads, setReloads] = useState(0)
  const turnEnds = useTurnEndCount(working)

  useEffect(() => {
    if (channel === null) return
    let current = true
    loadGitChanges({ channel, scope })
      .then((loaded) => {
        if (current)
          setSettled({
            scope,
            view: { status: EGitChangesStatus.Ready, ...loaded },
          })
      })
      .catch((error: unknown) => {
        if (current) {
          setSettled({
            scope,
            view: {
              status: EGitChangesStatus.Failed,
              message: messageOfFailure(error),
            },
          })
        }
      })
    return () => {
      current = false
    }
  }, [channel, scope, reloads, turnEnds])

  const reload = useCallback(() => {
    setSettled(null)
    setReloads((current) => current + 1)
  }, [])

  const view = settled !== null && settled.scope === scope ? settled.view : LOADING
  return { view, reload }
}
