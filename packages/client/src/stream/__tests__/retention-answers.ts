import { shellKey, type RecordEvent } from '@dltech/atlas-core'

import { applyPageOutcome, EMPTY_WINDOW, RENDER_LIMIT, type SessionWindow } from '../session-window'
import { headOf } from './support'

export type Answers = {
  openTurns: string[]
  lastTurnEnded: number | undefined
  openCalls: string[]
  openApprovals: string[]
  openRequests: string[]
  openShells: string[]
  openAgents: string[]
  failures: number[]
  refusals: number[]
  worktrees: [string, string | undefined][]
  paths: string[]
}

const closingSeqOf = (events: readonly RecordEvent[]): Map<string, number> => {
  const closers = new Map<string, number>()
  for (const event of events) {
    const key =
      event.type === 'tool-result' || event.type === 'tool-denied'
        ? `call:${event.callId}`
        : event.type === 'approval-answered'
          ? `approval:${event.callId}`
          : event.type === 'run-failure-dismissed'
            ? `failure:${event.failureSeq}`
            : undefined
    if (key !== undefined) closers.set(key, event.seq)
  }
  return closers
}

export const answersOf = (events: readonly RecordEvent[]): Answers => {
  const turns = new Map<string, boolean>()
  const calls = new Map<string, boolean>()
  const approvals = new Map<string, boolean>()
  const requests = new Map<string, boolean>()
  const shells = new Set<string>()
  const agents = new Set<string>()
  const failures: number[] = []
  const refusals: number[] = []
  const worktrees = new Map<string, string | undefined>()
  const paths = new Set<string>()
  let lastTurnEnded: number | undefined
  let clearedAt = 0
  const closers = closingSeqOf(events)
  const supersededAt = (seq: number): boolean =>
    events.some(
      (event) => event.seq > seq && (event.type === 'user-said' || event.type === 'assistant-said'),
    )

  for (const event of events) {
    switch (event.type) {
      case 'turn-started':
        turns.set(event.turnId, true)
        break
      case 'turn-ended':
        turns.set(event.turnId, false)
        lastTurnEnded = event.seq
        break
      case 'tool-called':
        calls.set(event.callId, true)
        break
      case 'tool-result':
      case 'tool-denied':
        calls.set(event.callId, false)
        break
      case 'approval-requested':
        approvals.set(event.callId, true)
        break
      case 'approval-answered':
        approvals.set(event.callId, false)
        break
      case 'operator-input-requested':
        requests.set(event.requestId, true)
        break
      case 'operator-input-resolved':
        requests.set(event.requestId, false)
        break
      case 'background-shell-started':
        shells.add(shellKey(event))
        break
      case 'background-shell-ended':
        shells.delete(shellKey(event))
        break
      case 'agent-spawned':
      case 'agent-restarted':
        agents.add(event.agentId)
        break
      case 'agent-ended':
        agents.delete(event.agentId)
        break
      case 'run-failed':
        if (!supersededAt(event.seq) && !closers.has(`failure:${event.seq}`))
          failures.push(event.seq)
        break
      case 'input-refused':
        refusals.push(event.seq)
        break
      case 'user-said':
      case 'assistant-said':
      case 'nudge':
        clearedAt = event.seq
        break
      case 'context-changed':
        for (const path of event.paths) paths.add(path)
        break
      case 'worktree-entered':
      case 'worktree-exited':
      case 'directory-changed':
      case 'location-changed':
        worktrees.set(event.threadId, event.type === 'worktree-entered' ? event.path : undefined)
        break
      default:
        break
    }
  }

  const openOf = (map: Map<string, boolean>): string[] =>
    [...map.entries()]
      .filter(([, open]) => open)
      .map(([key]) => key)
      .sort()
  return {
    openTurns: openOf(turns),
    lastTurnEnded,
    openCalls: openOf(calls),
    openApprovals: openOf(approvals),
    openRequests: openOf(requests),
    openShells: [...shells].sort(),
    openAgents: [...agents].sort(),
    failures,
    refusals: refusals.filter((seq) => seq > clearedAt),
    worktrees: [...worktrees.entries()].sort(),
    paths: [...paths].sort(),
  }
}

export const windowOf = (args: {
  events: readonly RecordEvent[]
  pageSize: number
}): SessionWindow => {
  let window = EMPTY_WINDOW
  for (let index = 0; index < args.events.length; index += args.pageSize) {
    const page = args.events.slice(index, index + args.pageSize)
    window = applyPageOutcome({
      window,
      page: { events: page.map((event) => ({ ...event })), head: headOf(args.events) },
      renderLimit: RENDER_LIMIT,
    }).window
  }
  return window
}
