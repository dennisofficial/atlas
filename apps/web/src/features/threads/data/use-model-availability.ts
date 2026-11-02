import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

import {
  channelSpeaksAvailability,
  readModelAvailability,
  EAvailabilityControlResult,
} from '@dltech/atlas-client/channel'
import {
  EModelWaitAction,
  modelWaitViewOf,
  OLD_SERVE_CONTROLS,
  type ModelWaitIssue,
  type ModelWaitView,
} from '@dltech/atlas-client/transcript'
import { waitingForModelSchema, type Event, type WaitingForModel } from '@dltech/atlas-core'
import type { ModelWaitCardProps } from '@dltech/atlas-ui/ai/model-wait-card'
import { EConnectionView } from '@dltech/atlas-client/channel'
import type { RosterWire, WaitingForModelWire } from '@dltech/atlas-wire/web'

import { PROVIDERS_HREF } from '@/features/settings/settings-nav'

import { controlCloudAvailability, type CloudAvailabilityControl } from './model-availability-api'
import {
  modelWaitCardPropsOf,
  noteOfFailure,
  noteOfResult,
  type IssueNote,
  type ModelWaitPending,
} from './model-wait-card-props'
import { runModelWaitAction, type ModelWaitControlAction } from '@dltech/atlas-client/channel'
import type { ServeChannel } from './live-thread-view'
import type { AccountDirectory } from './use-account-directory'

const NEEDS_SANDBOX = 'Open the sandbox to recheck access: send a message to wake it.'
const NO_CHANNEL: ServeChannel | null = null

export const snapshotOfWire = (
  wire: WaitingForModelWire | null | undefined,
): WaitingForModel | null => {
  if (wire === null || wire === undefined) return null
  const parsed = waitingForModelSchema.safeParse(wire)
  return parsed.success ? parsed.data : null
}

const waitEventCount = (events: readonly Event[]): number =>
  events.filter((event) => event.type === 'model-waiting' || event.type === 'model-wait-cleared')
    .length

const isControl = (action: EModelWaitAction): action is ModelWaitControlAction =>
  action !== EModelWaitAction.Providers

export type ModelAvailability = {
  waitingLive: readonly WaitingForModel[] | null
  card: ModelWaitCardProps | null
  view: ModelWaitView | null
}

export function useModelAvailability(args: {
  threadId: string
  events: readonly Event[]
  channel: ServeChannel | null
  snapshot: WaitingForModelWire | null | undefined
  accounts: AccountDirectory
  roster: RosterWire | null
  openAgent: (threadId: string) => void
  cloud?: CloudAvailabilityControl
}): ModelAvailability {
  const { events, snapshot: wireSnapshot, accounts, roster, openAgent } = args
  const channel = args.channel ?? NO_CHANNEL
  const cloud = args.cloud ?? controlCloudAvailability
  const router = useRouter()
  const [live, setLive] = useState<readonly WaitingForModel[] | null>(null)
  const [pending, setPending] = useState<ModelWaitPending | null>(null)
  const [notes, setNotes] = useState<ReadonlyMap<string, IssueNote>>(new Map())
  const guard = useRef<string | null>(null)

  const connected = channel !== null && channel.connection().state === EConnectionView.Connected
  const capable = channel !== null && connected && channelSpeaksAvailability(channel)
  const trigger = waitEventCount(events)

  const reload = useCallback(async () => {
    if (channel === null || !capable) return
    try {
      setLive(await readModelAvailability({ channel }))
    } catch {
      return
    }
  }, [channel, capable])

  useEffect(() => {
    if (channel === null) setLive(null)
  }, [channel])

  useEffect(() => {
    void reload()
  }, [reload, trigger])

  const snapshot = useMemo(() => snapshotOfWire(wireSnapshot), [wireSnapshot])
  const view = useMemo(
    () => modelWaitViewOf({ events, live, snapshot, accountLabelOf: accounts.labelOf }),
    [events, live, snapshot, accounts.labelOf],
  )

  const labelOfThread = useCallback(
    (threadId: string): string => {
      if (threadId === args.threadId) return 'This session'
      const agent = roster?.agents.find((entry) => entry.agentId === threadId)
      return agent === undefined ? threadId : `${agent.agentType} · ${agent.intent}`
    },
    [args.threadId, roster],
  )
  const onOpenThread = useCallback(
    (threadId: string): (() => void) | undefined =>
      roster?.agents.some((entry) => entry.agentId === threadId) === true
        ? () => openAgent(threadId)
        : undefined,
    [roster, openAgent],
  )

  const handleAction = useCallback(
    ({ issue, action }: { issue: ModelWaitIssue; action: EModelWaitAction }) => {
      if (action === EModelWaitAction.Providers) {
        router.push(PROVIDERS_HREF)
        return
      }
      if (!isControl(action) || channel === null || guard.current !== null) return
      guard.current = issue.key
      setPending({ key: issue.key, action })
      const accountId = issue.waiting.accountId
      void runModelWaitAction({
        waiting: issue.waiting,
        action,
        channel,
        cloudAccount: accountId !== null && accounts.isCloud(accountId),
        cloud,
        requestId: () => crypto.randomUUID(),
      })
        .then((result) => {
          setNotes((prior) => new Map(prior).set(issue.key, noteOfResult(result)))
          if (result !== EAvailabilityControlResult.Unreachable) void reload()
        })
        .catch((failure: unknown) => {
          setNotes((prior) => new Map(prior).set(issue.key, noteOfFailure(failure)))
        })
        .finally(() => {
          guard.current = null
          setPending(null)
        })
    },
    [accounts, channel, cloud, reload, router],
  )

  const card = useMemo(() => {
    if (view === null) return null
    return modelWaitCardPropsOf({
      view,
      controls: {
        enabled: capable,
        disabledReason: !connected ? NEEDS_SANDBOX : capable ? undefined : OLD_SERVE_CONTROLS,
        pending,
        notes,
        labelOfThread,
        onOpenThread,
        onAction: handleAction,
      },
    })
  }, [view, capable, connected, pending, notes, labelOfThread, onOpenThread, handleAction])

  return { waitingLive: live, card, view }
}
