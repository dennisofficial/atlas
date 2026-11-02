import { readModelAvailability } from '@dltech/atlas-client/channel'
import {
  controlFailureNoteOf,
  controlOutcomeNoteOf,
  OLD_SERVE_CONTROLS,
  type ControlOutcomeNote,
} from '@dltech/atlas-client/transcript'
import type { Event, ThreadId, WaitingForModel } from '@dltech/atlas-core'
import { EConnectionView } from '@dltech/atlas-harness'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { ModelWaitControlState, ModelWaitPending } from '../ui/model-wait-view'
import type { AtlasApp } from './compose'
import { modelWaitDispatchOf } from './model-wait-control'

const NEEDS_SANDBOX = 'Open the sandbox to recheck access: send a message to wake it.'

export type ModelAvailability = {
  waitingLive: readonly WaitingForModel[] | null
  accountLabelOf: (accountId: string) => string | undefined
  control: ModelWaitControlState
}

const waitEventCount = (events: readonly Event[]): number =>
  events.filter((event) => event.type === 'model-waiting' || event.type === 'model-wait-cleared')
    .length

export function useModelAvailability(args: {
  app: AtlasApp
  threadId: ThreadId
  events: readonly Event[]
}): ModelAvailability {
  const { app, threadId, events } = args
  const dispatch = useMemo(
    () => modelWaitDispatchOf({ app, requestId: () => crypto.randomUUID() }),
    [app],
  )
  const [version, setVersion] = useState(0)
  const [remoteLive, setRemoteLive] = useState<readonly WaitingForModel[] | null>(null)
  const [pending, setPending] = useState<ModelWaitPending | null>(null)
  const [notes, setNotes] = useState<ReadonlyMap<string, ControlOutcomeNote>>(new Map())
  const [labels, setLabels] = useState<ReadonlyMap<string, string>>(new Map())
  const guard = useRef<string | null>(null)
  const trigger = waitEventCount(events)
  const { remote } = dispatch
  const connected = remote === null || remote.connection().state === EConnectionView.Connected
  const capable = connected && dispatch.capable()

  const localLive = useMemo(
    () => (remote === null ? (app.availabilityControl?.waiting() ?? null) : null),
    // biome-ignore lint/correctness/useExhaustiveDependencies: the wait list changes with the log and with each control action
    [app, remote, trigger, version, threadId],
  )

  useEffect(() => {
    if (remote === null || !capable) {
      setRemoteLive(null)
      return undefined
    }
    let live = true
    void readModelAvailability({ channel: remote })
      .then((waiting) => {
        if (live) setRemoteLive(waiting)
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [remote, capable, trigger, version])

  const waitingLive = remote === null ? localLive : remoteLive
  const accountIds = useMemo(
    () =>
      [
        ...new Set(
          (waitingLive ?? []).flatMap((wait) => (wait.accountId === null ? [] : [wait.accountId])),
        ),
      ]
        .sort()
        .join('|'),
    [waitingLive],
  )
  useEffect(() => {
    if (accountIds === '') return undefined
    let live = true
    void app.accounts
      .list()
      .then((held) => {
        if (live) setLabels(new Map(held.map((account) => [account.id, account.label])))
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [app.accounts, accountIds])
  const accountLabelOf = useCallback((accountId: string) => labels.get(accountId), [labels])

  const labelOfThread = useCallback(
    (id: string): string => {
      if (id === threadId) return 'This session'
      const agent = app.agents.listEverywhere().find((entry) => entry.agentId === id)
      return agent === undefined ? id : `${agent.agentType} · ${agent.intent}`
    },
    [app.agents, threadId],
  )

  const handleAction = useCallback<ModelWaitControlState['onAction']>(
    ({ issue, action }) => {
      if (guard.current !== null || !capable) return
      guard.current = issue.key
      setPending({ key: issue.key, action })
      void dispatch
        .control({ waiting: issue.waiting, action })
        .then((result) => {
          setNotes((prior) => new Map(prior).set(issue.key, controlOutcomeNoteOf(result)))
          setVersion((current) => current + 1)
        })
        .catch((failure: unknown) => {
          setNotes((prior) => new Map(prior).set(issue.key, controlFailureNoteOf(failure)))
        })
        .finally(() => {
          guard.current = null
          setPending(null)
        })
    },
    [capable, dispatch],
  )

  const control = useMemo<ModelWaitControlState>(
    () => ({
      enabled: capable,
      disabledReason: !connected ? NEEDS_SANDBOX : capable ? undefined : OLD_SERVE_CONTROLS,
      pending,
      notes,
      labelOfThread,
      onAction: handleAction,
    }),
    [capable, connected, pending, notes, labelOfThread, handleAction],
  )
  return { waitingLive, accountLabelOf, control }
}
