import type { Event } from '@dltech/atlas-core'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'

import { RemoteTurnRunner, threadHandle } from '@dltech/atlas-harness'

import { useDelegatedToolCalls } from '../ui/hooks/use-delegated-tool-calls'
import { createAwakeClock } from './awake-clock'
import type { Conversation, ConversationArgs } from './conversation-types'
import type { OpenedConversation } from './open-conversation'
import { endedOnQuestion } from './title-state'
import { clockReadableAt, transcriptOfTurn } from './turn-progress'
import { useCompaction } from './use-compaction'
import { useConversationRotation } from './use-conversation-rotation'
import { useFailureNotice } from './use-failure-notice'
import { useSettledCommands } from './use-conversation-commands'
import { useConversationDirectory, usePendingMove } from './use-conversation-directory'
import { usePendingRows, useProjectEvents } from './use-conversation-projections'
import { useOperatorInput } from './use-operator-input'
import { useResumeOnOpen } from './use-conversation-resume'
import { usePlacementMoving, useRemotePending, useSendingChannel } from './use-conversation-send'
import { useMainWake } from './use-main-wake'
import { useSessionName } from './use-session-name'
import { titleDigestReader } from './title-digest'
import { EThreadRows, useThreadView } from './use-thread-view'
import { useThreadSwap } from './use-thread-swap'
import { useRunAttention } from './use-run-attention'
import { useAdopt } from './use-adopt'
import { useDriveRefusal } from './use-drive-refusal'
import { useThreadSeed } from './use-thread-seed'
import { useReportedUsage } from './use-reported-usage'
import { useTurnDriver } from './use-turn-driver'
import { useTickingNow } from './use-turn-clock'

export type { Conversation } from './conversation-types'

export function useConversation(args: ConversationArgs): Conversation {
  const { app, paceReveal, thinking, tldrStatus, onUndone } = args
  const [opened, setOpened] = useState<OpenedConversation>(args.opened)
  const { failure, setFailure, setTurnFailure, dismissalFor } = useFailureNotice()
  const { pendingMove, pendingMoveRef, holdMove } = usePendingMove()
  const startedRef = useRef(args.opened.started)

  const cancelRotationRef = useRef<() => boolean>(() => false)

  const threadId = opened.threadId
  const { setReported, forgetUsage, usedTokens } = useReportedUsage({ threadId })
  const moving = usePlacementMoving({ app, threadId })

  const clock = useMemo(() => createAwakeClock(), [])
  const readClock = clock.read

  const projectEvents = useProjectEvents({ app })

  const initial = useThreadSeed(opened)

  const pending = useMemo(() => app.pending.forThread({ threadId }), [app.pending, threadId])
  const cloudRunner = useMemo(
    () => (app.runner instanceof RemoteTurnRunner ? app.runner : null),
    [app.runner],
  )

  const driveRefusal = useDriveRefusal({ app, extra: args.driveRefusal })

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

  const { name, naming, namingRequest, setName, renameSession } = useSessionName({
    app,
    threads: args.threads ?? app.threads,
    threadId,
    started: startedRef,
    readDigest: titleDigestReader({ app, threads: args.threads, threadId }),
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
  const remote = useRemotePending({ app, cloudRunner, heldForWake: queued })

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
    setFailure: setTurnFailure,
    forgetUsage,
    cancelCompaction: () => compaction.cancel() || cancelRotationRef.current(),
    interruptRefusal: args.interruptRefusal,
    driveRefusal,
    frozen: moving,
    sending,
  })

  const channelReady = args.channelReady !== false
  const runAttention = useRunAttention({
    app,
    threadId,
    view,
    turnDriver,
    remote: cloudRunner !== null,
    moving,
    channelReady,
    onFailure: setFailure,
  })
  useResumeOnOpen({
    app,
    opened,
    turnDriver,
    moving,
    resumable: runAttention.handleResume !== null,
  })

  const { working, drive } = turnDriver
  const { compacting } = compaction
  const frozen = args.frozen === true
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

  const adopt = useAdopt({
    turnDriver,
    setFailure,
    setReported,
    holdMove,
    startedRef,
    setEvents,
    setName,
    setOpened,
    onLocalOpened: args.onLocalOpened,
  })
  const { handleNewConversation, handleOpenThread } = useThreadSwap({
    app,
    threadId,
    working: turnDriver.workingRef,
    adopt,
    onFailure: setFailure,
  })
  const { rotating, handleRotate, cancelRotation, handleSend, handleTakeBackPending } =
    useConversationRotation({
      app,
      threadId,
      readClock,
      compacting: compacting !== null,
      moving,
      working,
      pending,
      sending,
      cloudRunner,
      cloudView: args.cloudView ?? null,
      wakeCloud: args.wakeCloud ?? null,
      driver: turnDriver,
      refresh,
      setFailure,
      onRotated: forgetUsage,
    })
  cancelRotationRef.current = cancelRotation
  const now = useTickingNow({
    ticking: !frozen && (derived.streaming || working || compacting !== null || rotating !== null),
    clock,
  })
  const operatorInput = useOperatorInput({
    app,
    threadId,
    cloudRunner,
    onInterrupt: turnDriver.handleInterrupt,
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
  const questionAsked = useMemo(() => endedOnQuestion(events), [events])
  const readEvents = useCallback(
    (): Promise<readonly Event[]> => app.log.read({ threadId }),
    [app.log, threadId],
  )
  const used = usedTokens(logSummary.tokens)
  const delegatedToolCalls = useDelegatedToolCalls({ agents: app.agents, threadId })
  const rows = usePendingRows({
    queued,
    remoteEntries: remote.channel === null ? undefined : remote.entries,
    wakeNotices,
    sending: sending.rows,
  })

  const model = transcriptOfTurn({ model: derived, working, failure })

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
    endedOnQuestion: questionAsked,
    handleSend,
    handleQueueSettled,
    refresh,
    handleTakeBackPending,
    attention: runAttention.attention,
    handleRetry: runAttention.handleRetry,
    handleDismissFailure: dismissalFor() ?? runAttention.handleDismiss,
    handleResume: runAttention.handleResume,
    readEvents,
    loadOlderHistory: view.loadOlder,
    hasOlderHistory: logSummary.windowStartSeq > 1,
    compacting,
    rotating,
    handleRotate,
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
  }
}
