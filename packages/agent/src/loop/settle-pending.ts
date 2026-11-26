import {
  isConcurrencySafeCall,
  partitionToolCalls,
  settleablePendingOf,
  activeWorktreeAfter,
  activeWorktreeOfState,
  homeDirectoryAfter,
  homeDirectoryOfState,
  type ActiveWorktree,
  type ThreadId,
  type CallId,
  type Event,
  type EventDraft,
  type ToolDeclaration,
  type ToolOutputChunk,
} from '@dltech/atlas-core'

import type { AgentRecordPort } from '../record/agent-record.port'
import type { OnceLedger } from './once-ledger.port'
import type { PauseSignal } from './pause-signal'

import { detachedDispatchDraft } from '../tools/dispatch-drafts'
import type { DispatchableCall, ToolDispatcher } from '../tools/dispatch'

export type ToolOutputNotice = ToolOutputChunk & { callId: CallId }

export type OnToolOutputNotice = (args: ToolOutputNotice) => void

export type SettledPending = {
  paused?: { callId: CallId; reason: string }
  parked?: { callId: CallId; name: string }
  handoffPaused?: true
}

export type SettlePending = (args: {
  threadId: ThreadId
  signal: AbortSignal
  pause?: PauseSignal | undefined
}) => Promise<SettledPending>

const hostDetachedOnHandoff = (args: {
  signal: AbortSignal
  detach: ((name: string) => boolean) | undefined
  name: string
}): boolean =>
  args.signal.aborted && args.signal.reason === 'handoff' && args.detach?.(args.name) === false

export function createSettlePending(deps: {
  record: AgentRecordPort
  dispatch: ToolDispatcher
  tools?: (() => readonly ToolDeclaration[]) | undefined
  launchDirectory: string
  onToolOutput?: OnToolOutputNotice | undefined
  onceLedger?: OnceLedger | undefined
  detachTool?: ((name: string) => boolean) | undefined
}): SettlePending {
  const isSafe = (call: DispatchableCall): boolean => {
    const declarations = new Map((deps.tools?.() ?? []).map((tool) => [tool.name, tool]))
    return isConcurrencySafeCall({ declaration: declarations.get(call.name), input: call.input })
  }

  const settleOne = async (args: {
    call: DispatchableCall
    events: readonly Event[]
    signal: AbortSignal
    projectDirectory: string
    homeDirectory: string
    activeWorktree: ActiveWorktree | undefined
    paused: () => boolean
  }): Promise<readonly EventDraft[]> => {
    const { call } = args

    const tap = deps.onToolOutput
    return deps.dispatch.dispatch({
      call,
      signal: args.signal,
      projectDirectory: args.projectDirectory,
      homeDirectory: args.homeDirectory,
      activeWorktree: args.activeWorktree,
      events: args.events,
      onceLedger: deps.onceLedger,
      handedOff: args.paused,
      onDispatchStarted: async (draft) => {
        await deps.record.append({
          threadId: call.threadId,
          runId: call.runId,
          drafts: [draft],
          signal: args.signal,
        })
      },
      ...(tap === undefined
        ? {}
        : { onOutput: (chunk: ToolOutputChunk) => tap({ callId: call.callId, ...chunk }) }),
    })
  }

  return async ({ threadId, signal, pause }) => {
    const paused = (): boolean => pause?.paused === true
    const events = await deps.record.composedEvents({ threadId })
    const state = await deps.record.loopState({ threadId })

    const calls = [...settleablePendingOf(state)].sort(
      (left, right) => left.ordinal - right.ordinal,
    )

    const runs = partitionToolCalls({ calls, isSafe })

    let activeWorktree: ActiveWorktree | undefined = activeWorktreeOfState(state)
    let homeDirectory = homeDirectoryOfState({ state, launchDirectory: deps.launchDirectory })

    for (const [index, run] of runs.entries()) {
      if (signal.aborted) return {}
      if (paused()) return { handoffPaused: true }

      const current = index === 0 ? events : await deps.record.composedEvents({ threadId })
      const projectDirectory = activeWorktree?.path ?? homeDirectory
      const detach = deps.detachTool
      const detaching = signal.aborted || paused()
      const settled = await Promise.all(
        run.map(async (call) => {
          if (detaching) return []
          const drafts = await settleOne({
            call,
            events: current,
            signal,
            projectDirectory,
            homeDirectory,
            activeWorktree,
            paused,
          })
          if (hostDetachedOnHandoff({ signal, detach, name: call.name })) {
            await deps.record.append({
              threadId,
              runId: call.runId,
              drafts: [detachedDispatchDraft(call)],
            })
            return []
          }
          if ((signal.aborted || paused()) && detach?.(call.name) === true) return []
          if (drafts.length > 0) {
            await deps.record.append({ threadId, runId: call.runId, drafts, signal })
          }
          return drafts
        }),
      )

      const drafts = settled.flat()

      activeWorktree = activeWorktreeAfter({ drafts, active: activeWorktree })
      homeDirectory = homeDirectoryAfter({ drafts, home: homeDirectory })

      const parked = drafts.find((draft) => draft.type === 'tool-parked')
      if (parked !== undefined) return { parked: { callId: parked.callId, name: parked.name } }
    }

    return {}
  }
}
