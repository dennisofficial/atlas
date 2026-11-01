import {
  EGithubPrStatesFrame,
  type GithubPrStatesFrame,
  type WireSessionNode,
  type WireThread,
} from '@dltech/atlas-wire/web'

import type { ApiPrStatesSubscribe } from '@/features/threads/data/api-pr-states-source'
import {
  prObservationTargetsOf,
  type PrObservationTarget,
} from '@/features/threads/data/pr-observation-targets'
import { pullRequestKeyOf } from '@/features/threads/data/pull-request-entries'

import { updatedAt } from './production-sidebar-fixtures'

type StateFrame = Extract<GithubPrStatesFrame, { type: EGithubPrStatesFrame.PrState }>
type Channel = {
  observe: readonly PrObservationTarget[]
  onData: (frame: GithubPrStatesFrame) => void
}

enum EFixtureChannelEvent {
  Open = 'open',
  Close = 'close',
}

interface ChannelEvent {
  type: EFixtureChannelEvent
  id: number
  observe: readonly PrObservationTarget[] | null
}

export interface FixtureObservationSnapshot {
  activeChannels: number
  maximumChannels: number
  opens: number
  closes: number
  observedKeys: readonly string[]
  maximumRequestedTargets: number
  stateFrames: number
  emptyChannelStateFrames: number
  unavailable: boolean
  events: readonly ChannelEvent[]
}

function fixtureThreadsOf(sessions: readonly WireSessionNode[]): WireThread[] {
  return sessions.flatMap((session) => [session.mainThread, ...fixtureThreadsOf(session.teammates)])
}

function fixtureFramesOf(args: {
  sessions: readonly WireSessionNode[]
  failed: boolean
}): StateFrame[] {
  return fixtureThreadsOf(args.sessions).flatMap((thread) =>
    (thread.pullRequests ?? []).map((pr) => {
      const changing = pr.number === 1488 || pr.number === 1602
      const conflicts = pr.number === 1489 || pr.number === 1605
      return {
        type: EGithubPrStatesFrame.PrState,
        state: {
          repoFullName: pr.repo,
          prNumber: pr.number,
          title: pr.title ?? '',
          url: pr.url,
          state: pr.state ?? 'open',
          headBranch: pr.branch,
          headSha: 'storybook-fixture',
          checksRunning: changing && !args.failed ? 1 : 0,
          checksPassed: changing ? 3 : 4,
          checksFailed: (changing && args.failed) || conflicts ? 1 : 0,
          mergeable: !conflicts,
          updatedAt,
        },
      }
    }),
  )
}

export function createFixtureSource(sessions: readonly WireSessionNode[]) {
  let failed = false
  let unavailable = false
  let nextId = 0
  const channels = new Map<number, Channel>()
  const diagnostics = new Set<() => void>()
  let snapshot: FixtureObservationSnapshot = {
    activeChannels: 0,
    maximumChannels: 0,
    opens: 0,
    closes: 0,
    observedKeys: [],
    maximumRequestedTargets: 0,
    stateFrames: 0,
    emptyChannelStateFrames: 0,
    unavailable: false,
    events: [],
  }
  const publish = (changes: Partial<FixtureObservationSnapshot> = {}) => {
    snapshot = {
      ...snapshot,
      ...changes,
      activeChannels: channels.size,
      maximumChannels: Math.max(snapshot.maximumChannels, channels.size),
      observedKeys: prObservationTargetsOf(
        [...channels.values()].flatMap((channel) => channel.observe),
      ).map(pullRequestKeyOf),
      unavailable,
    }
    for (const listener of diagnostics) listener()
  }
  const emitStates = (channel: Channel) => {
    const observed = new Set(channel.observe.map(pullRequestKeyOf))
    let sent = 0
    for (const frame of fixtureFramesOf({ sessions, failed })) {
      if (
        !observed.has(
          pullRequestKeyOf({ repo: frame.state.repoFullName, number: frame.state.prNumber }),
        )
      )
        continue
      channel.onData(frame)
      sent += 1
    }
    publish({
      stateFrames: snapshot.stateFrames + sent,
      emptyChannelStateFrames:
        snapshot.emptyChannelStateFrames + (channel.observe.length === 0 ? sent : 0),
    })
  }
  const emitStatus = (channel: Channel) => {
    if (channel.observe.length === 0) return
    channel.onData({
      type: EGithubPrStatesFrame.ObservationStatus,
      available: !unavailable,
      ...(unavailable
        ? {
            message: 'Fixture observation unavailable. Cached checks may be stale.',
            retryAfterMs: 1500,
          }
        : {}),
    })
  }
  const broadcast = () => {
    for (const channel of channels.values()) {
      emitStatus(channel)
      if (!unavailable) emitStates(channel)
    }
    publish()
  }
  const subscribe: ApiPrStatesSubscribe = ({ observe, onData }) => {
    const id = ++nextId
    const targets = prObservationTargetsOf(observe ?? [])
    const channel = { observe: targets, onData }
    channels.set(id, channel)
    if (unavailable) unavailable = false
    publish({
      opens: snapshot.opens + 1,
      maximumRequestedTargets: Math.max(snapshot.maximumRequestedTargets, observe?.length ?? 0),
      events: [
        ...snapshot.events,
        {
          type: EFixtureChannelEvent.Open,
          id,
          observe: observe === undefined ? null : [...observe],
        },
      ].slice(-64),
    })
    emitStatus(channel)
    emitStates(channel)
    return {
      unsubscribe: () => {
        if (!channels.delete(id)) return
        publish({
          closes: snapshot.closes + 1,
          events: [
            ...snapshot.events,
            {
              type: EFixtureChannelEvent.Close,
              id,
              observe: observe === undefined ? null : [...observe],
            },
          ].slice(-64),
        })
      },
    }
  }
  return {
    subscribe,
    snapshot: () => snapshot,
    subscribeDiagnostics: (listener: () => void) => {
      diagnostics.add(listener)
      return () => {
        diagnostics.delete(listener)
      }
    },
    toggle: () => {
      failed = !failed
      broadcast()
      return failed
    },
    repeat: broadcast,
    failObservation: () => {
      unavailable = true
      broadcast()
    },
    recoverObservation: () => {
      unavailable = false
      broadcast()
    },
  }
}

export type FixtureSource = ReturnType<typeof createFixtureSource>
