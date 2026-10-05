import { contextTokens, type Event, type ModelUsage } from '@dltech/atlas-core'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'

import { RemoteTurnRunner, sessionDigest, threadHandle } from '@dltech/atlas-harness'

import { useDelegatedToolCalls } from '../ui/hooks/use-delegated-tool-calls'
import { createAwakeClock } from './awake-clock'
import type { Conversation, ConversationArgs } from './conversation-types'
import type { OpenedConversation } from './open-conversation'
import { useRevokeGrant } from './revoke-grant'
import { clockReadableAt, transcriptOfTurn } from './turn-progress'
import { useCompaction } from './use-compaction'
import { useFailureNotice } from './use-failure-notice'
import { useSettledCommands } from './use-conversation-commands'
import { useConversationDirectory, usePendingMove } from './use-conversation-directory'
import { usePendingRows, useProjectEvents } from './use-conversation-projections'
import { useOperatorInput } from './use-operator-input'
import { useResumeOnOpen } from './use-conversation-resume'
import { usePlacementMoving, useRemotePending, useSendingChannel, useSendMessage, useTakeBackPending } from './use-conversation-send'
import { useMainWake } from './use-main-wake'
import { useSessionName } from './use-session-name'
import { EThreadRows, useThreadView, type ThreadSeed } from './use-thread-view'
import { useThreadSwap } from './use-thread-swap'
import { useTurnDriver } from './use-turn-driver'
import { useTickingNow } from './use-turn-clock'

export type { Conversation } from './conversation-types'

export function useConversation(args: ConversationArgs): Conversation {
  const { app, paceReveal, thinking, tldrStatus, onUndone } = args
  const [opened, setOpened] = useState<OpenedConversation>(args.opened)
  const { failure, setFailure, dismissalFor } = useFailureNotice()
  const [reported, setReported] = useState<ModelUsage | null>(null)
  const { pendingMove, pendingMoveRef, holdMove } = usePendingMove()
  const startedRef = useRef(args.opened.started)

  const forgetUsage = useCallback(() => setReported(null), [])

  const threadId = opened.threadId
  const moving = usePlacementMoving({ app, threadId })

  const clock = useMemo(() => createAwakeClock(), [])
  const readClock = clock.read

  const projectEvents = useProjectEvents({ app })

  const initial = useCallback(
    (): ThreadSeed => ({
      events: opened.events,
      turns: opened.turns,
      ...(opened.base === undefined ? {} : { base: opened.base }),
      ...(opened.identity === undefined ? {} : { identity: opened.identity }),
      ...(opened.appliedEvents === undefined ? {} : { appliedEvents: opened.appliedEvents }),
    }),
    [opened],
  )

  const pending = useMemo(() => app.pending.forThread({ threadId }), [app.pending, threadId])
  const cloudRunner = useMemo(
    () => (app.runner instanceof RemoteTurnRunner ? app.runner : null),
    [app.runner],
  )

  const localDriveRefusal = useCallback((): string | null => {
    const owned = app.sessionOwner.snapshot()
    if (owned.bound) return null
    return 'the sandbox is still connecting — your message sends once the channel is open'
  }, [app.sessionOwner])
  const driveRefusal = useCallback(
    (): string | null => localDriveRefusal() ?? args.driveRefusal?.() ?? null,
    [localDriveRefusal, args.driveRefusal],
  )

  const sending = useSendingChannel({ app, cloudRunner, opened })
  const { drainSettledCommands, handleQueueSettled } = useSettledCommands({ pending })

  const view = useThreadView({
    app,
    threadId,
    rows: EThreadRows.Composed,
    thinking,
    tldrStatus,
    readClock,
    initial,
    paceReveal,
    projectEvents,
    onUsage: setReported,
  })

  const { store, events, setEvents, refresh } = view
  const logSummary = useSyncExternalStore(store.subscribe, store.getLogSummary)
  useEffect(() => sending.reconcile(events), [events, sending])

  const handleRevokeGrant = useRevokeGrant({ app, threadId, refresh })
  const { name, naming, namingRequest, setName, renameSession } = useSessionName({
    app,
    threads: args.threads ?? app.threads,
    threadId,
    started: startedRef,
    readDigest: async () => sessionDigest(await app.log.read({ threadId })),
    initial: args.opened.name,
  })

  const started = opened.started || events.length > 0
  useEffect(
    () => app.markActiveThread({ threadId, title: name, started }),
    [app, name, threadId, started],
  )
  useEffect(() => store.setName(name), [store, name])

  const derived = view.model
  const { sidebar } = view
  const queued = useSyncExternalStore(pending.subscribe, pending.getSnapshot)
  const remote = useRemotePending({ app, cloudRunner })

  const compaction = useCompaction({
    app,
    threadId,
    readClock,
    refresh,
    onFailure: setFailure,
    onCompacted: forgetUsage,
    frozen: moving,
  })

  const turnDriver = useTurnDriver({
    app,
    threadId,
    started: startedRef,
    pendingMove: pendingMoveRef,
    view,
    readClock,
    onSettled: drainSettledCommands,
    onUndone,
    setFailure,
    forgetUsage,
    cancelCompaction: compaction.cancel,
    interruptRefusal: args.interruptRefusal,
    driveRefusal,
    frozen: moving,
  })

  useResumeOnOpen({ app, opened, turnDriver, moving })

  const { working, drive } = turnDriver
  const { compacting } = compaction
  const frozen = args.frozen === true
  const now = useTickingNow({
    ticking: !frozen && (derived.streaming || working || compacting !== null),
    clock,
  })
  const { turn } = view

  const handleWake = useCallback(() => void drive([]), [drive])
  const wakeNotices = useMainWake({
    shells: app.shells,
    agents: app.agents,
    services: app.services,
    threadId,
    working,
    isRunning: turnDriver.turnInFlight,
    canWake: args.canWake,
    onWake: handleWake,
    intake: app.intake,
  })

  const handleSend = useSendMessage({
    app,
    threadId,
    pending,
    sending,
    cloudRunner,
    working,
    moving,
    drive,
    setFailure,
  })
  const handleTakeBackPending = useTakeBackPending({ threadId, cloudRunner, moving, pending, sending })

  const adopt = useCallback(
    (next: OpenedConversation) => {
      turnDriver.settle()
      setFailure(null)
      setReported(null)
      holdMove(null)
      startedRef.current = next.started
      setEvents(next.events)
      setName(next.name)
      setOpened(next)
      args.onLocalOpened?.(next)
    },
    [args.onLocalOpened, holdMove, setEvents, setName, turnDriver],
  )
  const { handleNewConversation, handleOpenThread } = useThreadSwap({
    app,
    threadId,
    working: turnDriver.workingRef,
    adopt,
    onFailure: setFailure,
  })
  const { workspace, handleChangeDirectory } = useConversationDirectory({
    app,
    threadId,
    opened,
    name,
    started,
    events,
    logSummary,
    pendingMove,
    holdMove,
    refresh,
  })
  const readEvents = useCallback(
    (): Promise<readonly Event[]> => app.log.read({ threadId }),
    [app.log, threadId],
  )
  const used = useMemo(
    () => (reported === null ? logSummary.tokens : contextTokens({ reported, events: [] })),
    [reported, logSummary],
  )
  const delegatedToolCalls = useDelegatedToolCalls({ agents: app.agents, threadId })
  const rows = usePendingRows({
    queued,
    remoteEntries: remote.channel === null ? undefined : remote.entries,
    wakeNotices,
    sending: sending.rows,
  })
  const operatorInput = useOperatorInput({
    app,
    threadId,
    cloudRunner,
    onInterrupt: turnDriver.handleInterrupt,
  })

  const model = transcriptOfTurn({ model: derived, working, failure })
  const channelReady = args.channelReady !== false
  const retryable =
    model.failure !== null && !working && !turnDriver.turnInFlight() && !moving && channelReady
  const resumable =
    model.failure === null &&
    !working &&
    !turnDriver.turnInFlight() &&
    turnDriver.isResumable &&
    !moving &&
    channelReady

  return {
    rewindConfirm: turnDriver.rewindConfirm,
    projectDirectory: workspace.projectDirectory,
    activeWorktree: workspace.activeWorktree,
    repo: workspace.repo,
    threadId,
    started,
    threadModel: opened.model,
    executionLocation: opened.executionLocation,
    attachPending: !app.sessionOwner.snapshot().bound,
    lost: opened.lost ?? null,
    lostShells: opened.lostShells ?? [],
    handle: name === null ? null : threadHandle({ threadId, title: name }),
    sessionName: name,
    naming,
    namingRequest,
    model,
    sidebar,
    turn,
    now: clockReadableAt({ now, clock: turn }),
    working,
    turnInFlight: turnDriver.turnInFlight,
    mutations: logSummary.treeMutations + delegatedToolCalls,
    contextTokens: used,
    pending: rows,
    operatorInput,
    handleSend,
    handleQueueSettled,
    refresh,
    handleTakeBackPending,
    handleRetry: retryable ? turnDriver.handleRetry : null,
    handleDismissFailure: dismissalFor(derived.failure),
    handleResume: resumable ? turnDriver.handleResume : null,
    readEvents,
    loadOlderHistory: view.loadOlder,
    hasOlderHistory: logSummary.windowStartSeq > 1,
    compacting,
    handleReportProblem: setFailure,
    handleInterrupt: turnDriver.handleInterrupt,
    handleInterruptForMove: turnDriver.handleInterruptForMove,
    handlePauseForMove: turnDriver.handlePauseForMove,
    handleResumeSource: turnDriver.handleResume,
    whenSettled: turnDriver.whenSettled,
    handleNewConversation,
    handleOpenThread,
    handleChangeDirectory,
    handleRename: renameSession,
    handleCompact: compaction.compact,
    handleCompactAround: compaction.compactAround,
    handleRewindTo: turnDriver.handleRewindTo,
    handleRevokeGrant,
  }
}
