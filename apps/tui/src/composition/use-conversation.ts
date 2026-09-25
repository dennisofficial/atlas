import {
  activeWorktreeOf,
  contextTokens,
  ECompactionAnchor,
  EExecutionLocation,
  projectDirectoryOf,
  repoOf,
  treeMutationsOf,
  type ActiveWorktree,
  type ThreadId,
  type Event,
  type EventDraft,
  type ModelUsage,
  type SaidImage,
} from '@dltech/atlas-core'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'

import {
  EChannelConnection,
  publishProjections,
  RemoteTurnRunner,
  type RemoteDeltaChannel,
} from '@dltech/atlas-harness'

import {
  pendingRows,
  type EThinkingVisibility,
  type PendingRow,
  type PendingSaid,
  type SidebarModel,
  type TranscriptModel,
} from '../store'
import type { Compacting } from '../ui/components/compacting'
import type { TurnClock } from '../ui/turn-clock'
import { ENoticeTone, NOTICE_WARN_MS, notify } from '../ui/notice-store'
import { createAwakeClock } from './awake-clock'
import { droppedNotice, type QueuedSettled } from './commands'
import { ECommandEffect, type CommandEffect } from './commands/local-command'
import type { AtlasApp } from './compose'
import { changeDirectory, type DirectoryMove } from './directory-move'
import type { OpenedConversation } from './open-conversation'
import type { LostShell, RecoveredAgents, ThreadModel } from '@dltech/atlas-harness'
import { ECompactScope } from '@dltech/atlas-harness'
import { EOpenMode } from './config'
import { useRevokeGrant } from './revoke-grant'
import type { Renaming } from './session-rename'
import { terminalTitleSequence } from './terminal-title'
import { threadHandle } from '@dltech/atlas-harness'
import { userSaidDraft } from '@dltech/atlas-harness'
import { useCompaction } from './use-compaction'
import { useDelegatedToolCalls } from '../ui/hooks/use-delegated-tool-calls'
import { sessionDigest } from './session-rename'
import { useSessionName } from './use-session-name'
import { useMainWake } from './use-main-wake'
import { EThreadRows, useThreadView, type ThreadSeed } from './use-thread-view'
import { useSendingRows } from './use-sending-rows'
import { useThreadSwap } from './use-thread-swap'
import type { RewindConfirmControl } from './use-rewind-confirm'
import { useTurnDriver } from './use-turn-driver'
import { useTickingNow } from './use-turn-clock'
import { clockReadableAt, transcriptOfTurn } from './turn-progress'

const NO_IMAGES: readonly SaidImage[] = Object.freeze([])

const ALREADY_OPEN = Promise.resolve()

export type Conversation = {
  threadId: ThreadId
  started: boolean
  threadModel: ThreadModel | undefined
  executionLocation: EExecutionLocation | undefined
  rewindConfirm: RewindConfirmControl
  lost: RecoveredAgents | null
  lostShells: readonly LostShell[]
  handle: string | null
  model: TranscriptModel
  sidebar: SidebarModel
  turn: TurnClock
  now: number
  working: boolean
  turnInFlight: () => boolean
  mutations: number
  contextTokens: number
  projectDirectory: string
  activeWorktree: ActiveWorktree | null
  repo: string | null
  pending: readonly PendingRow[]
  readEvents: () => Promise<readonly Event[]>
  loadOlderHistory: () => Promise<void>
  hasOlderHistory: boolean
  refresh: () => Promise<void>
  handleSend: (args: {
    text: string
    images?: readonly SaidImage[]
    context?: readonly EventDraft[]
  }) => void
  handleQueueSettled: (entry: QueuedSettled) => void
  handleTakeBackPending: () => PendingSaid | null
  handleRetry: (() => void) | null
  handleResume: (() => void) | null
  handleReportProblem: (reason: string) => void
  handleInterrupt: () => void
  handleInterruptForMove: () => void
  whenSettled: () => Promise<void>
  compacting: Compacting | null
  handleNewConversation: () => void
  handleOpenThread: (threadId: string) => void
  handleChangeDirectory: (argumentText: string) => Promise<CommandEffect>
  handleRename: (argumentText: string) => Promise<Renaming>
  handleCompact: (scope: ECompactScope) => void
  handleCompactAround: (args: { anchor: ECompactionAnchor; seq: number }) => void
  handleRewindTo: (toSeq: number) => void
  handleRevokeGrant: (grantId: string) => void
}

export function useConversation(args: {
  app: AtlasApp
  opened: OpenedConversation
  paceReveal: boolean
  autoCompactAtPercent: number
  thinking: EThinkingVisibility
  tldrStatus: boolean
  onUndone: (said: PendingSaid) => void
  canWake: boolean
  interruptRefusal?: (() => string | null) | undefined
}): Conversation {
  const { app, paceReveal, thinking, tldrStatus, onUndone } = args
  const [opened, setOpened] = useState<OpenedConversation>(args.opened)
  const [failure, setFailure] = useState<string | null>(null)
  const [reported, setReported] = useState<ModelUsage | null>(null)
  const [pendingMove, setPendingMove] = useState<DirectoryMove | null>(null)
  const pendingMoveRef = useRef<DirectoryMove | null>(null)
  const usedRef = useRef(0)
  const startedRef = useRef(args.opened.started)

  const forgetUsage = useCallback(() => setReported(null), [])

  const threadId = opened.threadId

  const clock = useMemo(() => createAwakeClock(), [])
  const readClock = clock.read

  const projectEvents = useCallback(
    ({ events: folded }: { events: readonly Event[] }) => {
      const broke = publishProjections({ projections: app.pluginProjections, events: folded })
      if (broke.length === 0) return

      notify({
        key: `projection:${broke.join(',')}`,
        tone: ENoticeTone.Warn,
        ttlMs: NOTICE_WARN_MS,
        text: `projection failed: ${broke.join(', ')}`,
      })
    },
    [app.pluginProjections],
  )

  const initial = useCallback(
    (): ThreadSeed => ({ events: opened.events, turns: opened.turns }),
    [opened],
  )

  const pending = useMemo(() => app.pending.forThread({ threadId }), [app.pending, threadId])

  const cloudRunner = useMemo(
    () => (app.runner instanceof RemoteTurnRunner ? app.runner : null),
    [app.runner],
  )

  const sending = useSendingRows()

  useEffect(() => sending.reconcile(opened.events), [opened, sending])

  /**
   * A close with a send in flight means the commit will never answer: the runner's own drive
   * reports it as an error, but a steered message has no promise attached, so the socket state is
   * the only witness it has. Held rather than dropped — what was typed is user data.
   */
  useEffect(() => {
    if (cloudRunner === null) return undefined

    const channel = app.channel
    if (!('onConnection' in channel)) return undefined

    return (channel as RemoteDeltaChannel).onConnection((connection) => {
      if (connection.state === EChannelConnection.Closed) sending.markAllSendingFailed()
    })
  }, [app.channel, cloudRunner, sending])

  /**
   * Settled commands wait in the same queue as the messages, but drain in the driver's own settle
   * path, before `working` flips: a wake or an auto-compaction reacting to the settle must find
   * the queued work already running, not beat it. A command that swaps the thread out strands the
   * commands queued behind it, so it says so and ends the drain.
   */
  const drainSettledCommands = useCallback(async (): Promise<void> => {
    const queuedCommands = pending.drainCommands()
    if (queuedCommands.length === 0) return

    for (const [index, entry] of queuedCommands.entries()) {
      const { command } = entry
      if (command.dropsQueue) {
        const dropped = droppedNotice({
          command: command.name,
          messages: command.losesWaiting
            ? pending.getSnapshot().filter((one) => one.kind === 'message').length
            : 0,
          commands: queuedCommands.slice(index + 1).map((one) => one.command.name),
        })
        if (dropped !== null) {
          notify({
            key: 'queued-dropped',
            text: dropped,
            tone: ENoticeTone.Warn,
            ttlMs: NOTICE_WARN_MS,
          })
        }
      }

      const effect = await command.run()
      if (effect.type === ECommandEffect.Refused) {
        notify({ text: effect.reason, tone: ENoticeTone.Warn, ttlMs: NOTICE_WARN_MS })
      } else if (effect.type === ECommandEffect.Ran && effect.notice !== undefined) {
        notify({ text: effect.notice })
      }

      if (command.dropsQueue) return
    }
  }, [pending])

  const handleQueueSettled = useCallback(
    (entry: QueuedSettled): void => {
      pending.enqueueCommand({ text: entry.text, command: entry })
    },
    [pending],
  )

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

  const { name, naming, setName, nameSession, renameSession } = useSessionName({
    app,
    threadId,
    started: startedRef,
    opening: logSummary.opening,
    readDigest: async () => sessionDigest(await app.log.read({ threadId })),
    initial: args.opened.name,
  })

  const started = opened.started || events.length > 0

  useEffect(
    () => app.markActiveThread({ threadId, title: name, started }),
    [app, name, threadId, started],
  )

  useEffect(() => store.setName(name), [store, name])

  useEffect(() => store.setNaming(naming), [store, naming])

  const derived = view.model
  const { sidebar } = view

  const queued = useSyncExternalStore(pending.subscribe, pending.getSnapshot)

  const compaction = useCompaction({
    app,
    threadId,
    atPercent: args.autoCompactAtPercent,
    readClock,
    refresh,
    onFailure: setFailure,
    onCompacted: forgetUsage,
  })

  const turnDriver = useTurnDriver({
    app,
    threadId,
    started: startedRef,
    pendingMove: pendingMoveRef,
    view,
    readClock,
    used: usedRef,
    compactIfFull: compaction.compactIfFull,
    cancelCompaction: compaction.cancel,
    onSettled: drainSettledCommands,
    onUndone,
    setFailure,
    forgetUsage,
    interruptRefusal: args.interruptRefusal,
  })

  const resumeAtLaunch = useRef(app.config.open.mode !== EOpenMode.New)
  const resumeOnArrival = useRef(opened.resumeOnArrival === true)

  /**
   * A lift that caught a turn mid-flight interrupted it to make the move safe, so the freshly
   * attached cloud conversation resumes it itself — discarding the interrupted tail the same way
   * an operator picking "resume fresh" would, but without asking, since the move is what asked.
   */
  useEffect(() => {
    if (resumeOnArrival.current) {
      resumeOnArrival.current = false
      resumeAtLaunch.current = false
      turnDriver.handleResumeFresh()
      return
    }

    if (!resumeAtLaunch.current) return
    resumeAtLaunch.current = false
    if (turnDriver.isResumable) turnDriver.handleResume()
  }, [turnDriver])

  const { working, drive } = turnDriver
  const { compacting } = compaction
  const now = useTickingNow({
    ticking: derived.streaming || working || compacting !== null,
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
    canWake: args.canWake,
    onWake: handleWake,
  })

  const notices = wakeNotices.shells
  const agentNotices = wakeNotices.agents
  const serviceNotices = wakeNotices.services

  const handleSend = useCallback(
    (args: { text: string; images?: readonly SaidImage[]; context?: readonly EventDraft[] }) => {
      const text = args.text.trim()
      const images = args.images ?? NO_IMAGES
      if (text.length === 0) return

      if (working) {
        if (cloudRunner !== null) {
          sending.add(text)
          cloudRunner.steer({
            threadId,
            text,
            images,
            ...(args.context === undefined ? {} : { context: args.context }),
          })
          nameSession({ said: text, opened: ALREADY_OPEN, images, context: args.context })
          return
        }

        pending.enqueue({ text, images })
        nameSession({ said: text, opened: ALREADY_OPEN, images, context: args.context })
        return
      }

      const drained = [...pending.drain()]
      const sendingId = sending.add(text)
      const onCommitFailed = (): void => {
        for (const said of drained) sending.resolve(said.text)
        sending.markFailed(sendingId)
      }

      const opened = drive(
        [
          ...(args.context ?? []),
          ...[...drained, { text, images }].map(userSaidDraft),
        ],
        { onCommitFailed },
      )
      nameSession({ said: text, opened, images, context: args.context })
    },
    [cloudRunner, drive, nameSession, pending, sending, threadId, working],
  )

  /**
   * Only the queue is taken back: once the loop has drained a message into the log, the edit route
   * is interrupt-and-resend, not a second retraction path that would have to race the stream.
   */
  const handleTakeBackPending = useCallback((): PendingSaid | null => pending.takeBackLast(), [pending])

  /**
   * Shell endings are not dropped on the way out: they belong to the thread that started the shell,
   * so leaving one keeps its queue for when it is opened again.
   */
  const adopt = useCallback(
    (next: OpenedConversation) => {
      turnDriver.settle()
      setFailure(null)
      setReported(null)
      pendingMoveRef.current = null
      setPendingMove(null)
      startedRef.current = next.started
      setEvents(next.events)
      setName(next.name)
      setOpened(next)
    },
    [setEvents, setName, turnDriver],
  )

  const { handleNewConversation, handleOpenThread } = useThreadSwap({
    app,
    threadId,
    working: turnDriver.workingRef,
    adopt,
    onFailure: setFailure,
  })

  /**
   * The visible conversation's directory is a plugin fact the turn hooks learn too late: a resumed
   * thread can sit in a worktree for hours before its first turn. Mounting and every adopt announce
   * it instead, so a surface that follows the session is right before anyone speaks.
   */
  useEffect(() => {
    void app.threadOpened({
      threadId: opened.threadId,
      projectDirectory:
        logSummary.worktree?.path ?? logSummary.home ?? app.workspace.workspace,
    })
  }, [app, opened, logSummary, app.workspace.workspace])

  const readEvents = useCallback(
    (): Promise<readonly Event[]> => app.log.read({ threadId }),
    [app.log, threadId],
  )

  const used = useMemo(
    () => (reported === null ? logSummary.tokens : contextTokens({ reported, events: [] })),
    [reported, logSummary],
  )

  const mutations = logSummary.treeMutations

  const delegatedToolCalls = useDelegatedToolCalls({ agents: app.agents, threadId })

  const workspace = useMemo((): {
    projectDirectory: string
    activeWorktree: ActiveWorktree | null
    repo: string | null
  } => {
    const launchDirectory = app.workspace.workspace
    if (pendingMove !== null && events.length === 0) {
      return { projectDirectory: pendingMove.path, activeWorktree: null, repo: pendingMove.repo }
    }
    return {
      projectDirectory: logSummary.worktree?.path ?? logSummary.home ?? launchDirectory,
      activeWorktree: logSummary.worktree ?? null,
      repo: logSummary.repo ?? app.workspace.repo,
    }
  }, [events, pendingMove, logSummary, app.workspace.workspace, app.workspace.repo])

  const holdMove = useCallback((move: DirectoryMove | null): void => {
    pendingMoveRef.current = move
    setPendingMove(move)
  }, [])

  const handleChangeDirectory = useCallback(
    (argumentText: string): Promise<CommandEffect> =>
      changeDirectory({
        app,
        threadId,
        started,
        workspace,
        holdMove,
        refresh,
        argumentText,
      }),
    [app, holdMove, refresh, started, threadId, workspace],
  )
  usedRef.current = used

  useEffect(() => {
    process.stdout.write(
      terminalTitleSequence({ name, directory: workspace.projectDirectory }),
    )
    app.journalResume({
      active: { threadId, title: name, started },
      directory: workspace.projectDirectory,
    })
  }, [app, name, started, threadId, workspace.projectDirectory])

  const rows = useMemo(
    () =>
      pendingRows({
        entries: queued,
        notices,
        agents: agentNotices,
        services: serviceNotices,
        sending: sending.rows,
      }),
    [agentNotices, notices, queued, sending.rows, serviceNotices],
  )

  const model = transcriptOfTurn({ model: derived, working, failure })
  const retryable = model.failure !== null && !working
  const resumable =
    model.failure === null && !working && !turnDriver.turnInFlight() && turnDriver.isResumable

  return {
    rewindConfirm: turnDriver.rewindConfirm,
    projectDirectory: workspace.projectDirectory,
    activeWorktree: workspace.activeWorktree,
    repo: workspace.repo,
    threadId,
    started,
    threadModel: opened.model,
    executionLocation: opened.executionLocation,
    lost: opened.lost ?? null,
    lostShells: opened.lostShells ?? [],
    handle: name === null ? null : threadHandle({ threadId, title: name }),
    model,
    sidebar,
    turn,
    now: clockReadableAt({ now, clock: turn }),
    working,
    turnInFlight: turnDriver.turnInFlight,
    mutations: mutations + delegatedToolCalls,
    contextTokens: used,
    pending: rows,
    handleSend,
    handleQueueSettled,
    refresh,
    handleTakeBackPending,
    handleRetry: retryable ? turnDriver.handleRetry : null,
    handleResume: resumable ? turnDriver.handleResume : null,
    readEvents,
    loadOlderHistory: view.loadOlder,
    hasOlderHistory: logSummary.windowStartSeq > 1,
    compacting,
    handleReportProblem: setFailure,
    handleInterrupt: turnDriver.handleInterrupt,
    handleInterruptForMove: turnDriver.handleInterruptForMove,
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
