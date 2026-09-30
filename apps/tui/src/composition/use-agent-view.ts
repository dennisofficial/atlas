import type { SaidFile, SaidImage, ThreadId } from '@dltech/atlas-core'
import { EKilledBy, TEAMMATE_AGENT_TYPE, type AgentSnapshot } from '@dltech/atlas-harness'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'

import { isSubagentAlive, subagentLabel } from '../store/subagent-row'
import { EKeyGroup, EKeyLayer, useKeyBindings } from '../ui/keys'
import { notify } from '../ui/notice-store'
import type { AtlasApp } from './compose'

export type AgentView = {
  /** The thread whose crew the sidebar lists — the main thread, or the teammate being visited. */
  scopeId: ThreadId
  /** The teammate the whole tile is scoped to, when one is. */
  scopedTo: AgentSnapshot | null
  /** The child open inside the scope, when one is. */
  viewing: ThreadId | null
  /** The roster's reading of the open child, which is what its transcript is mounted from. */
  selected: AgentSnapshot | null
  /** Whoever the composer addresses: the open child, else the scoped teammate, else nobody. */
  addressing: ThreadId | null
  name: string | null
  /** The pill above the transcript while away from the main session. */
  backLabel: string | null
  /** Set after a first escape on a running child — the next one stops it. */
  stopArmed: boolean
  /** Cancel a pending stop confirmation; the caller runs this on any non-escape key. */
  disarmStop: () => void
  /** The deepest agent being read, whose departure restarts its retirement clock. */
  inside: ThreadId | null
  handleSelect: (agentId: string) => void
  handleBack: () => void
  handleCycle: () => boolean
  handleStop: () => void
  handleEscape: () => void
  handleSay: (said: {
    text: string
    images?: readonly SaidImage[] | undefined
    files?: readonly SaidFile[] | undefined
  }) => Promise<string | null>
}

type ViewState = { scope: ThreadId | null; viewing: ThreadId | null }

const AT_MAIN: ViewState = { scope: null, viewing: null }

/**
 * Where a row click takes the tile. A teammate is a peer session, so clicking one scopes the whole
 * tile to it — sidebar, footer and composer follow, and its own crew becomes clickable in turn. A
 * sub-agent is an extension of the scope's thread, so clicking one moves only the transcript and
 * the composer's addressee.
 */
export function useAgentView(args: {
  app: AtlasApp
  threadId: ThreadId
  onFocusComposer: () => void
  onProblem: (reason: string) => void
}): AgentView {
  const { app, threadId, onFocusComposer, onProblem } = args
  const agents = app.agents

  const [state, setState] = useState<ViewState>(AT_MAIN)
  const [stopArmed, setStopArmed] = useState(false)

  /**
   * The escape binding re-registers on its hint's change one render after the arm flips, so a fast
   * second escape can still reach the handler that read the unarmed state. The ref is the answer
   * the handler actually trusts — it is current the moment the state is set, before any effect.
   */
  const stopArmedRef = useRef(false)
  const armStop = useCallback((armed: boolean) => {
    stopArmedRef.current = armed
    setStopArmed(armed)
  }, [])

  useEffect(() => setState(AT_MAIN), [threadId])

  const move = useCallback(
    (next: ViewState) => {
      setState(next)
      armStop(false)
      onFocusComposer()
    },
    [armStop, onFocusComposer],
  )

  const subscribe = useCallback((listener: () => void) => agents.onChange(listener), [agents])
  const read = useCallback(() => agents.listEverywhere(), [agents])
  const everywhere = useSyncExternalStore(subscribe, read)

  const scopeId = state.scope ?? threadId
  const readOwn = useCallback(() => agents.list({ threadId: scopeId }), [agents, scopeId])
  const own = useSyncExternalStore(subscribe, readOwn)

  const scopedTo = useMemo(
    () =>
      state.scope === null
        ? null
        : (everywhere.find((one) => one.agentId === state.scope) ?? null),
    [everywhere, state.scope],
  )
  const selected = useMemo(
    () =>
      state.viewing === null
        ? null
        : (everywhere.find((one) => one.agentId === state.viewing) ?? null),
    [everywhere, state.viewing],
  )

  /**
   * A child vanishes from the roster when a rewind or a cleanup removes it, and a view onto a
   * removed agent can never be addressed again — so the view walks back to whatever still exists.
   */
  useEffect(() => {
    if (state.viewing !== null && selected === null) {
      setState((current) => ({ scope: current.scope, viewing: null }))
      return
    }
    if (state.scope !== null && scopedTo === null) setState(AT_MAIN)
  }, [scopedTo, selected, state.scope, state.viewing])

  const handleSelect = useCallback(
    (agentId: string) => {
      const snapshot = everywhere.find((one) => one.agentId === agentId)
      if (snapshot === undefined) return

      if (snapshot.agentType === TEAMMATE_AGENT_TYPE) {
        move(state.scope === agentId ? AT_MAIN : { scope: agentId as ThreadId, viewing: null })
        return
      }

      move({
        scope: state.scope,
        viewing: state.viewing === agentId ? null : (agentId as ThreadId),
      })
    },
    [everywhere, move, state],
  )

  const handleBack = useCallback(() => {
    move(state.viewing !== null ? { scope: state.scope, viewing: null } : AT_MAIN)
  }, [move, state])

  /**
   * The level above sits at the end of the ring rather than outside it, so the same chord that
   * walks into the crew also walks back out — escape stays the shortcut, not the only way. Landing
   * on a teammate steps into its scope, and the ring continues with that teammate's own crew.
   */
  const handleCycle = useCallback((): boolean => {
    if (own.length === 0 && state.scope === null) return false

    const at = state.viewing === null ? -1 : own.findIndex((one) => one.agentId === state.viewing)
    const next = own[at + 1]

    if (next === undefined) {
      move(state.viewing !== null ? { scope: state.scope, viewing: null } : AT_MAIN)
      return true
    }

    if (next.agentType === TEAMMATE_AGENT_TYPE) {
      move({ scope: next.agentId, viewing: null })
      return true
    }

    move({ scope: state.scope, viewing: next.agentId })
    return true
  }, [move, own, state])

  const addressing = state.viewing ?? state.scope

  /**
   * Both refusals the supervisor can give — an agent it does not hold, a type no longer on disk —
   * mean this agent can never be addressed again, so the view comes back to where the caller's
   * report of the reason is actually on screen. The addressing thread is whoever the supervisor
   * holds the addressee under: the scoped teammate answers to the main thread, a child open inside
   * a scope answers to the scope.
   */
  const handleSay = useCallback(
    async (said: {
      text: string
      images?: readonly SaidImage[] | undefined
      files?: readonly SaidFile[] | undefined
    }): Promise<string | null> => {
      if (addressing === null) return null

      const owner = state.viewing === null ? threadId : scopeId
      const outcome = await agents.say({ agentId: addressing, threadId: owner, ...said })
      if (outcome.ok) return null

      move(AT_MAIN)
      return outcome.reason
    },
    [addressing, agents, move, scopeId, state.viewing, threadId],
  )

  /**
   * Stopping a child is killing a background job, so it reads as one: the child stays on screen
   * afterwards, because its log is the record of what the operator just cut short.
   */
  const handleStop = useCallback((): void => {
    if (state.viewing === null) return

    const outcome = agents.stop({ agentId: state.viewing, threadId: scopeId, by: EKilledBy.User })
    if (!outcome.ok) onProblem(outcome.reason)
    armStop(false)
  }, [agents, armStop, onProblem, scopeId, state.viewing])

  const stoppable = selected !== null && isSubagentAlive(selected)

  const name =
    selected !== null
      ? subagentLabel(selected)
      : scopedTo !== null
        ? subagentLabel(scopedTo)
        : null

  /**
   * The child's working line already promises "esc to interrupt", and the first escape arms that
   * promise rather than keeping it: a stray escape must not kill a session with its own worktree.
   * The second escape stops the child; on a settled child, or with nothing open but a scope, escape
   * walks back one level instead.
   */
  const handleEscape = useCallback((): void => {
    if (state.viewing === null) {
      if (state.scope !== null) move(AT_MAIN)
      return
    }

    if (!stoppable) {
      move({ scope: state.scope, viewing: null })
      return
    }

    if (!stopArmedRef.current) {
      armStop(true)
      notify({ text: `esc again to stop ${name ?? 'this sub-agent'} — any other key cancels` })
      return
    }

    handleStop()
  }, [armStop, handleStop, move, name, state, stoppable])

  const inside = state.viewing ?? state.scope

  const backLabel =
    state.viewing !== null && scopedTo !== null
      ? `back to ${subagentLabel(scopedTo)}`
      : inside !== null
        ? 'back to main agent'
        : null

  /**
   * The hint never changes: the registry re-binds on a hint's change one render after the arm
   * flips, and a second escape landing in that gap would fall through to the global interrupt
   * instead of stopping the child. A stable hint keeps the binding put; the arming is announced by
   * the notice, not the hint.
   */
  const escapeHint =
    state.viewing !== null && stoppable
      ? `stop ${name ?? 'this sub-agent'}`
      : backLabel !== null
        ? backLabel
        : 'back to the parent'

  useKeyBindings(
    inside === null
      ? []
      : [
          {
            chord: 'escape',
            hint: escapeHint,
            layer: EKeyLayer.Block,
            group: EKeyGroup.Session,
            run: handleEscape,
          },
        ],
  )

  const disarmStop = useCallback((): void => {
    if (stopArmedRef.current) armStop(false)
  }, [armStop])

  return useMemo(
    () => ({
      scopeId,
      scopedTo,
      viewing: state.viewing,
      selected,
      addressing,
      name,
      backLabel,
      stopArmed,
      disarmStop,
      inside,
      handleSelect,
      handleBack,
      handleCycle,
      handleStop,
      handleEscape,
      handleSay,
    }),
    [
      addressing,
      backLabel,
      disarmStop,
      handleBack,
      handleCycle,
      handleEscape,
      handleSay,
      handleSelect,
      handleStop,
      inside,
      name,
      scopeId,
      scopedTo,
      selected,
      state.viewing,
      stopArmed,
    ],
  )
}
