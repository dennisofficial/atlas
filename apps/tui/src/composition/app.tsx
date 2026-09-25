import { homedir } from 'node:os'

import type { KeyEvent, PasteEvent } from '@opentui/core'
import { usePaste, useKeyboard, useRenderer, useTerminalDimensions } from '@opentui/react'
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'

import {
  contextPressure,
  ECompactionAnchor,
  EExecutionLocation,
  EForkMode,
  EKilledBy,
  launchWorktreeOf,
  type Account,
  type EUsageWindow,
  type ModelCard,
} from '@dltech/atlas-core'
import { EChannelConnection, forkConversation, readGhAuthToken, relocateSession, requireVercelCredentials, sandboxImageOf, settingModelRef, suggestedModelRef, type DiscoveredSkill } from '@dltech/atlas-harness'

import { newestExpandableKey, type PendingSaid } from '../store'
import { withCloud, withContainer, withSections } from '../store/sidebar-model'
import { accountMeterSpans } from '../ui/account-meters'
import { isWaiting, type BackgroundWork } from '../ui/background-wait'
import type { Span } from '../ui/components/spans'
import type { FooterMeter } from '../ui/usage-meters'
import { CommandMenu } from '../ui/components/command-menu'
import { FileMenu } from '../ui/components/file-menu'
import { Composer, composerRows, composerTone } from '../ui/components/composer'
import {
  readClipboardImage,
  readImageBase64,
  type ClipboardImageReader,
} from '../ui/clipboard-image'
import { restoredImages, submissionOf } from '../ui/draft-images'
import { isEmptyPaste, pastedContent } from '../ui/pasted-text'
import { useDraftTokens } from '../ui/hooks/use-draft-tokens'
import { liveTokens, tokenAtOffset, tokenizablePaste, type LiveToken } from '../ui/composer-tokens'
import { pasteDirectoryOf } from './paste-directory'
import { Footer, type FooterContext } from '../ui/components/footer'
import { footerLayout } from '../ui/footer-layout'
import { Screen } from '../ui/components/screen'
import { HeaderBar } from '../ui/components/header-bar'
import { useDiffStat } from '../ui/hooks/use-diff-stat'
import { useTerminalFocus } from '../ui/hooks/use-terminal-focus'
import { AgentTypes } from '../ui/components/agent-types'
import { LostChildren } from '../ui/components/lost-children'
import { hasLostChildren, lostChildrenNotice } from '../ui/lost-children-model'
import { hasLostShells, lostShellsNotice } from '../ui/lost-shells-model'
import { Shortcuts } from '../ui/components/shortcuts'
import { Sidebar } from '../ui/components/sidebar'
import { NoticeStack } from '../ui/components/notice-stack'
import { WelcomeScreen } from '../ui/components/welcome-screen'
import { Transcript } from '../ui/components/transcript'
import { useDraft } from '../ui/hooks/use-draft'
import { useSince } from '../ui/hooks/use-since'
import { composerEdgeVersion, subscribeComposerEdge } from '../ui/composer-edge-store'
import { densityVersion, subscribeDensity } from '../ui/density-store'
import { modelLabel } from '../ui/model-label'
import { isShellRunning } from '../ui/shells-model'
import { theme } from '../ui/theme'
import {
  clearNotice,
  configureNotices,
  ENoticeTone,
  NOTICE_KEY_CLASSIFIER_OFFLINE,
  NOTICE_KEY_LOST_AGENTS,
  NOTICE_KEY_LOST_SHELLS,
  NOTICE_WARN_MS,
  notify,
} from '../ui/notice-store'
import { paletteVersion, subscribePalette } from '../ui/palette-store'
import { ERewindPointKind, ERewindVerb, type RewindChoice } from '../ui/rewind-model'
import { SelectionSurface } from '../ui/selection/selection-surface'
import { useCopyOnSelect } from '../ui/selection/use-copy-on-select'
import {
  chromeWidthOf,
  contentWidthOf,
  ESidebarLayout,
  floatingSidebarWidth,
  peekInForce,
  sidebarLayout,
  sidebarShown,
} from '../ui/sidebar-visibility'
import { welcomeCells, welcoming } from '../ui/welcome-state'
import {
  createKeyRegistry,
  EKeyGroup,
  EKeyLayer,
  KeyRegistryContext,
  useKeyBindings,
  useKeyRegistry,
} from '../ui/keys'
import { commandSpecs, dispatchSubmission, EContainerAsk, EDispatch, localCommands } from './commands'
import {
  currentLocationNotice,
  movedLocationNotice,
  moveFailedNotice,
  movingNotice,
  pendingSwitchNotice,
} from './container-notices'
import { ELocalMoveStep } from './container-move'
import { messageOf } from './error-text'
import { useContainerMove } from './use-container-move'
import { mcpReport } from '@dltech/atlas-harness'
import { useComposerMenus } from './use-composer-menus'
import { workspaceFileLoader } from './mentioned-files'
import { useResolvedMentions } from './use-resolved-mentions'
import type { AtlasApp } from './compose'
import { reloadedSkills, type SkillsReloaded } from './skills-reload'
import { globalBindings } from './global-bindings'
import { applyTranscriptCovered } from '../ui/covered-store'
import { OverlayStack } from './overlay-stack'
import { unmeasuredWindowWarning } from '@dltech/atlas-harness'
import { settleStaleness } from './auto-restart'
import {
  checkForUpdate,
  releaseWatchProbe,
  sourceStalenessProbe,
  type ReleaseWatch,
  type SourceStaleness,
} from './update-check'
import { closeConversation, unstartedConversation, type OpenedConversation } from './open-conversation'
import { useConversation } from './use-conversation'
import { DETACH_EXIT_LINE } from '../ui/exit-guard-model'
import { useExitGuard } from './use-exit-guard'
import {
  composerCovered,
  covering,
  keyOwners,
  transcriptCovered,
  type OverlayPresence,
} from './overlay-presence'
import { useOverlayKeys } from './use-overlay-keys'
import { useModelChecks } from './use-model-checks'
import { useOnboarding } from './use-onboarding'
import { useSettings } from './use-settings'
import { useServices } from './use-services'
import { useShells } from './use-shells'
import { subagentsSurface } from './agents-surface'
import { servicesSurface } from './services-surface'
import { shellsSurface } from './shells-surface'
import { usePluginSurfaces } from './use-plugin-surfaces'
import { useFooterStrip } from './use-footer-strip'
import { useRewind } from './use-rewind'
import { useAccounts } from './use-accounts'
import { useAgents } from './use-agents'
import { useAgentView } from './use-agent-view'
import { SubagentTranscript } from './subagent-transcript'
import { useAgentsPicker } from './use-agents-picker'
import { settingTarget, useSwitcher } from './use-switcher'
import { useThreadModel } from './use-thread-model'
import { useContainerGuard } from './use-container-guard'
import { useContainerPill } from './use-container-pill'
import { useLocationItems } from './use-location-items'
import { useExecutionLocation } from './use-execution-location'
import { useThreads } from './use-threads'
import { useUsageMeters } from './use-usage-meters'
import { createCloudBridge } from './cloud/create-bridge'
import { mergeRemoteMemoryBounded } from './cloud/bounded-merge-remote-memory'
import { createCloudSession, type CloudSession } from './cloud/cloud-session'
import { descendFromCloud } from './cloud/descend'
import { liftRefusal } from './cloud/lift-plan'
import { openCloudConversation } from './cloud/cloud-app'
import type { CloudBridge } from './cloud/cloud-bridge'
import { useThreadRouter } from './use-thread-router'
import type { CloudBridgeFactory, LiftPreflight, WorkspaceCapture } from './use-cloud-lift'
import { useCloudLift } from './use-cloud-lift'
import { captureWorkspace } from './cloud/workspace-snapshot'
import type { CaptureContext } from './cloud/context-archive'
import { useCloudSession } from './use-cloud-session'
import type { LiftedAttachment, LiftedSession } from './lifted-session'
import { buildInfo, clientVersionHeader, EBuildKind, versionLabel } from '../build/info'

const STEER_PLACEHOLDER = 'Steer the turn'

const SUBAGENT_PLACEHOLDER = 'Message this sub-agent'

const HELP_KEY = '?'

const STALE_CHECK_MS = 60_000

const SOCKET_DOWN_REFUSAL = "the sandbox socket is down — esc will interrupt once it's back"

const SANDBOX_PARKED_REFUSAL = 'the sandbox is parked — send a message to wake it first'

/**
 * Reference the operator reads and dismisses, drawn above the composer rather than over it. One at
 * a time, and any key puts it away, which is what makes it a veil rather than an overlay.
 */
enum EChromePanel {
  Shortcuts = 'shortcuts',
  AgentTypes = 'agent-types',
  LostAgents = 'lost-agents',
}

const composerPlaceholder = (args: {
  addressingChild: boolean
  working: boolean
}): string | undefined => {
  if (args.addressingChild) return SUBAGENT_PLACEHOLDER
  return args.working ? STEER_PLACEHOLDER : undefined
}

const readoutOf = (args: {
  card: ModelCard | undefined
  used: number
  meters: readonly FooterMeter[]
}): FooterContext | null => {
  const { card } = args

  if (card === undefined) return { percent: 0, measured: false, meters: args.meters }

  const pressure = contextPressure({ used: args.used, window: card.contextWindow })
  return { percent: pressure.percent, tokensUsed: pressure.used, meters: args.meters }
}

/**
 * The live bridge closes over the app's settings and secrets: the claim rides the Atlas Cloud
 * session, but every Vercel call is driven with the operator's own token, read fresh from the
 * sealed secrets file at each attach so a rotated token is picked up without a restart.
 */
const releaseBuildOf = (): { version: string; buildSha: string } | undefined => {
  const build = buildInfo()
  if (build.kind !== EBuildKind.Release || build.buildSha === null) return undefined
  return { version: build.version, buildSha: build.buildSha }
}

const liveBridgeFor = (app: AtlasApp): CloudBridgeFactory => {
  return ({ url, token }) =>
    createCloudBridge({
      url,
      token,
      clientVersion: clientVersionHeader(),
      vercel: () => ({
        credentials: requireVercelCredentials({ settings: app.settings, secrets: app.secrets }),
        ...sandboxImageOf({ settings: app.settings, release: releaseBuildOf() }),
      }),
      readGitToken: () => readGhAuthToken(),
    })
}

/**
 * The same checks the bridge's create would hit, run up front: a lift with no Vercel credentials
 * or no gh login refuses before anything stops or transfers, instead of failing at the sandbox
 * wait four steps in.
 */
const liveLiftPreflightFor =
  (app: AtlasApp): LiftPreflight =>
  async () => {
    try {
      requireVercelCredentials({ settings: app.settings, secrets: app.secrets })
      await readGhAuthToken()
      return null
    } catch (error) {
      return messageOf(error)
    }
  }

/**
 * A lift is the conversation opened again as a cloud thread, not the running one rewired: the
 * workspace remounts against the remote stores under a fresh key, so every hook below reads the
 * cloud log from its first render rather than swapping ports out from under a live session. A
 * reload — the channel saying its delta buffer could not resume — re-reads the durable log the
 * same way, which is why it counts into the key.
 */
export function App(props: {
  app: AtlasApp
  opened: OpenedConversation
  credentialNotice?: string | null
  covered?: boolean
  clipboard?: ClipboardImageReader
  onRestart?: () => void
  createBridge?: CloudBridgeFactory
  preflightLift?: LiftPreflight
  captureWorkspace?: WorkspaceCapture
  captureContext?: CaptureContext
}): React.ReactNode {
  const registry = useMemo(() => createKeyRegistry(), [])
  const [lifted, setLifted] = useState<LiftedSession | null>(null)
  const [reopened, setReopened] = useState<OpenedConversation | null>(null)
  const held = useRef<LiftedSession | null>(null)
  held.current = lifted

  const reloading = useRef(false)
  const reloadPending = useRef(false)

  const handleReload = useCallback(() => {
    const attached = held.current
    if (attached === null) return
    if (reloading.current) {
      reloadPending.current = true
      return
    }

    reloading.current = true
    void openCloudConversation({
      app: attached.app,
      threadId: attached.opened.threadId,
    })
      .then((opened) =>
        setLifted((current) =>
          current === null ? current : { ...current, opened, reloads: current.reloads + 1 },
        ),
      )
      .catch(() => undefined)
      .finally(() => {
        reloading.current = false
        if (!reloadPending.current) return
        reloadPending.current = false
        handleReload()
      })
  }, [])

  const handleLifted = useCallback(
    (attachment: LiftedAttachment) => {
      held.current?.session.close()

      setLifted({
        ...attachment,
        session: createCloudSession({
          channel: attachment.channel,
          sandboxes: attachment.bridge.sandboxes,
          onReload: handleReload,
        }),
        reloads: 0,
      })
    },
    [handleReload],
  )

  const handleDescend = useCallback((opened: OpenedConversation) => {
    held.current?.session.close()
    setLifted(null)
    setReopened(opened)
  }, [])

  return (
    <KeyRegistryContext.Provider value={registry}>
      <Workspace
        key={
          lifted === null
            ? `local:${reopened?.threadId ?? 'boot'}`
            : `cloud:${lifted.opened.threadId}:${lifted.reloads}`
        }
        app={lifted?.app ?? props.app}
        localApp={props.app}
        opened={lifted?.opened ?? reopened ?? props.opened}
        cloudSession={lifted?.session ?? null}
        cloudBridge={lifted?.bridge ?? null}
        createBridge={props.createBridge ?? liveBridgeFor(props.app)}
        preflightLift={props.preflightLift ?? liveLiftPreflightFor(props.app)}
        captureWorkspace={props.captureWorkspace ?? captureWorkspace}
        captureContext={props.captureContext}
        onLifted={handleLifted}
        onDescend={handleDescend}
        credentialNotice={props.credentialNotice ?? null}
        covered={props.covered === true}
        clipboard={props.clipboard ?? readClipboardImage}
        onRestart={props.onRestart ?? null}
      />
    </KeyRegistryContext.Provider>
  )
}

function Workspace(props: {
  app: AtlasApp
  localApp: AtlasApp
  opened: OpenedConversation
  credentialNotice: string | null
  covered: boolean
  clipboard: ClipboardImageReader
  onRestart: (() => void) | null
  cloudSession: CloudSession | null
  cloudBridge: CloudBridge | null
  createBridge: CloudBridgeFactory
  preflightLift: LiftPreflight
  captureWorkspace: WorkspaceCapture
  captureContext: CaptureContext | undefined
  onLifted: (attachment: LiftedAttachment) => void
  onDescend: (opened: OpenedConversation) => void
}): React.ReactNode {
  const renderer = useRenderer()
  const restarting = useRef(false)
  const cloud = props.cloudBridge !== null
  const exitGuard = useExitGuard({
    cloud,
    onExit: () => {
      if (restarting.current && props.onRestart !== null) {
        props.onRestart()
        return
      }
      void closeConversation()
      renderer.destroy()
    },
    onDetach: () => {
      props.cloudSession?.close()
      if (restarting.current && props.onRestart !== null) {
        props.onRestart()
        return
      }
      void closeConversation()
      renderer.destroy()
      process.stdout.write(`${DETACH_EXIT_LINE}\n`)
    },
  })
  const { width, height } = useTerminalDimensions()
  useSyncExternalStore(subscribePalette, paletteVersion)
  useSyncExternalStore(subscribeDensity, densityVersion)
  useSyncExternalStore(subscribeComposerEdge, composerEdgeVersion)
  const usageVersion = useSyncExternalStore(props.app.usage.subscribe, props.app.usage.version)
  const accountsVersion = useSyncExternalStore(props.app.models.subscribe, props.app.models.version)

  const chooseModelSetting = useRef<((id: string) => void) | null>(null)
  const handleChooseModelSetting = useCallback((id: string) => {
    chooseModelSetting.current?.(id)
  }, [])

  const settings = useSettings({ app: props.app, onChooseModel: handleChooseModelSetting })
  useModelChecks(props.app)

  useCopyOnSelect()

  const draft = useDraft()

  const handleFocusComposer = useCallback(() => draft.editor.current?.focus(), [draft])

  const restoreUndone = useRef<(said: PendingSaid) => void>(() => undefined)
  const handleUndone = useCallback((said: PendingSaid) => restoreUndone.current(said), [])

  const containerMove = useContainerMove()

  const cloudHealth = useCloudSession({ session: props.cloudSession })

  /**
   * A turn on a cloud thread keeps running on the sandbox through a reconnect by design, so Esc
   * cannot actually stop it while the socket that would carry the frame is down — it would only
   * queue an interrupt nothing delivers. Every state but Open reads as down for this purpose;
   * Parked gets its own reason because waking it takes a message, not a keystroke.
   */
  const interruptRefusal = useCallback((): string | null => {
    const state = cloudHealth?.connection?.state
    if (state === undefined || state === EChannelConnection.Open) return null
    if (state === EChannelConnection.Parked) return SANDBOX_PARKED_REFUSAL
    return SOCKET_DOWN_REFUSAL
  }, [cloudHealth])

  const moveInFlight = containerMove.move !== null && containerMove.move.failure === null

  const conversation = useConversation({
    app: props.app,
    opened: props.opened,
    paceReveal: settings.paceReveal,
    autoCompactAtPercent: settings.autoCompactAtPercent,
    thinking: settings.thinking,
    tldrStatus: settings.tldrStatus,
    onUndone: handleUndone,
    canWake: exitGuard.state === null && !moveInFlight,
    interruptRefusal,
  })

  const tokens = useDraftTokens({
    editor: draft.editor,
    read: props.clipboard,
    directory: pasteDirectoryOf(conversation.threadId),
  })

  useEffect(() => {
    restoreUndone.current = (said) => {
      draft.setValue(said.text)
      tokens.restore(restoredImages({ images: said.images, text: said.text }))
    }
  }, [draft, tokens])

  const [peeking, setPeeking] = useState(false)
  const { sidebarWidth, sidebarFoldBelow } = settings
  const layout = sidebarLayout({ width, foldBelow: sidebarFoldBelow, sidebarWidth })
  const wide = layout === ESidebarLayout.Wide

  const tone = composerTone({
    working: conversation.working,
    interrupting: conversation.turn.interrupting,
  })

  const threadModel = useThreadModel({
    app: props.app,
    threadId: conversation.threadId,
    stored: conversation.threadModel,
    started: conversation.started,
  })

  const execution = useExecutionLocation({
    app: props.app,
    threadId: conversation.threadId,
    stored: conversation.executionLocation,
    started: conversation.started,
  })
  const containerPill = useContainerPill({
    app: props.app,
    connection: cloudHealth?.connection ?? null,
  })
  const locationItems = useLocationItems({
    app: props.app,
    connection: cloudHealth?.connection ?? null,
  })

  const { selection } = threadModel

  const [panel, setPanel] = useState<EChromePanel | null>(null)
  const [sends, setSends] = useState(0)
  const [opened, setOpened] = useState<ReadonlySet<string>>(() => new Set<string>())
  const [loadedSkills, setLoadedSkills] = useState<readonly DiscoveredSkill[]>(() =>
    props.app.skillRegistry.all(),
  )

  const card = props.app.models.cardFor(selection.ref)

  const metered = props.app.models.subscribed(selection.ref.providerId)

  const meters = useUsageMeters({
    usage: props.app.usage,
    metered,
    show: settings.footerMeters,
    warn: settings.usageWarn,
  })

  const { contextTokens } = conversation
  const readout = useMemo(
    () => readoutOf({ card, used: contextTokens, meters }),
    [card, contextTokens, meters],
  )

  useEffect(() => {
    const warning = unmeasuredWindowWarning({
      catalogue: props.app.models,
      ref: props.app.model.choice().ref,
    })
    if (warning === null) return

    notify({
      key: 'context-window-unmeasured',
      text: warning,
      tone: ENoticeTone.Warn,
      ttlMs: NOTICE_WARN_MS,
    })
  }, [props.app.model, props.app.models])

  /**
   * Ambient and off the boot path: a stale-build or release-available notice may arrive a beat
   * after the curtain lifts, and a probe that cannot reach its ground truth says nothing. The
   * staleness probe stamps the source tree at launch; the slow timer and the turn-end edge below
   * are what act on it.
   */
  const staleness = useRef<SourceStaleness | null>(null)
  const releaseWatch = useRef<ReleaseWatch | null>(null)
  useEffect(() => {
    void checkForUpdate()

    let mounted = true
    void sourceStalenessProbe().then((probe) => {
      if (mounted) staleness.current = probe
    })
    void releaseWatchProbe().then((watch) => {
      if (mounted) releaseWatch.current = watch
    })

    return () => {
      mounted = false
    }
  }, [])

  const { usage } = props.app
  const working = conversation.working

  useEffect(() => {
    if (working) {
      usage.track()
      return
    }
    usage.stopTracking()
  }, [usage, working])

  const handleNewConversation = useCallback(() => {
    draft.clear()
    if (props.cloudSession === null) {
      conversation.handleNewConversation()
      return
    }
    if (working) return

    props.onDescend(unstartedConversation({ ids: props.localApp.ids }))
  }, [conversation, draft, working, props.cloudSession, props.localApp, props.onDescend])

  const heldSettingRef = useCallback(
    (id: string) => {
      const settled = props.app.settings.snapshot().resolution
      return (
        settingModelRef({ id, settled, catalogue: props.app.models }) ??
        suggestedModelRef({ id, settled, catalogue: props.app.models })
      )
    },
    [props.app],
  )

  const switcher = useSwitcher({
    catalogue: props.app.models,
    accountsVersion,
    active: selection.ref,
    effort: selection.effort,
    fallback: threadModel.fallback,
    settingRef: heldSettingRef,
    favourites: settings.modelFavourites,
    onPick: threadModel.handlePicked,
    onPin: settings.handlePinModels,
  })

  const openSwitcher = switcher.handleOpen

  useEffect(() => {
    chooseModelSetting.current = (id) => {
      const definition = props.app.settings.definitions.find((one) => one.id === id)
      openSwitcher(settingTarget({ id, label: definition?.label ?? id }))
    }
  }, [openSwitcher, props.app.settings.definitions])

  const shells = useShells({ app: props.app, threadId: conversation.threadId })
  const services = useServices({ app: props.app })

  const { lost, lostShells } = conversation

  const handleShowLostAgents = useCallback((): boolean => {
    if (!hasLostChildren(lost)) return false

    clearNotice({ key: NOTICE_KEY_LOST_AGENTS })
    setPanel(EChromePanel.LostAgents)
    return true
  }, [lost])

  /**
   * Announced rather than raised: nothing else in the conversation will ever mention a child with
   * no `agent-spawned` behind it, so a sticky notice stands until the card it points at is opened.
   * The card itself stays asked for — a conversation reopened only to be read is not interrupted.
   */
  useEffect(() => {
    if (!hasLostChildren(lost)) {
      clearNotice({ key: NOTICE_KEY_LOST_AGENTS })
      return
    }

    notify({
      key: NOTICE_KEY_LOST_AGENTS,
      text: lostChildrenNotice(lost),
      tone: ENoticeTone.Warn,
      sticky: true,
    })
  }, [lost])

  useEffect(() => {
    if (!hasLostShells(lostShells)) {
      clearNotice({ key: NOTICE_KEY_LOST_SHELLS })
      return
    }

    notify({
      key: NOTICE_KEY_LOST_SHELLS,
      text: lostShellsNotice(lostShells),
      tone: ENoticeTone.Warn,
      sticky: true,
    })
  }, [lostShells])

  const judgeUnreachable = conversation.sidebar.classifier?.judgeUnreachable === true

  useEffect(() => {
    if (!judgeUnreachable) {
      clearNotice({ key: NOTICE_KEY_CLASSIFIER_OFFLINE })
      return
    }

    notify({
      key: NOTICE_KEY_CLASSIFIER_OFFLINE,
      text: 'nudge offline — the classifier could not be reached',
      tone: ENoticeTone.Warn,
      sticky: true,
    })
  }, [judgeUnreachable])

  useEffect(() => {
    configureNotices({ ttlMs: settings.noticeSeconds * 1000 })
  }, [settings.noticeSeconds])

  const routeRef = useRef<(threadId: string) => void>(() => undefined)

  const handleOpenThread = useCallback(
    (threadId: string) => {
      draft.clear()
      routeRef.current(threadId)
    },
    [draft],
  )

  const agentView = useAgentView({
    app: props.app,
    threadId: conversation.threadId,
    onFocusComposer: handleFocusComposer,
    onProblem: conversation.handleReportProblem,
  })

  const agents = useAgents({
    app: props.app,
    threadId: conversation.threadId,
    sidebar: conversation.sidebar,
    viewing: agentView.viewing,
    shells: shells.everywhere,
  })

  const agentsPicker = useAgentsPicker({
    app: props.app,
    threadId: conversation.threadId,
    onPick: agentView.handleSelect,
  })

  /**
   * What the settled turn is still waiting on, and since when.
   *
   * Measured here rather than in the line that draws it, because the transcript unmounts whenever a
   * sub-agent is opened: a reading taken at the render site would restart every time the operator
   * looked at a child and came back. Nothing about the wait is a fact about which thread is on
   * screen, so nothing about it belongs below this point.
   */
  const background = useMemo(
    (): BackgroundWork => ({ agents: agents.running, shells: shells.running }),
    [agents.running, shells.running],
  )
  const waitingSince = useSince(isWaiting(background))

  /**
   * Nothing said yet is a state of its own, not an empty transcript: the wordmark and the composer
   * sit centred with the whole terminal to themselves, and the sidebar stays away until there is a
   * conversation for it to read.
   */
  const welcome = welcoming({
    model: conversation.model,
    addressingChild: agentView.viewing !== null,
  })
  const sidebarVisible = !welcome && sidebarShown({ layout, peeking })
  const overlay = sidebarVisible && !wide

  const repoRoot = conversation.repo ?? conversation.projectDirectory
  const sidebarWorktree =
    conversation.activeWorktree?.path ??
    (conversation.projectDirectory.startsWith(`${repoRoot}/`)
      ? conversation.projectDirectory
      : null)
  const projectRoot = sidebarWorktree === null ? conversation.projectDirectory : repoRoot
  const headerDiff = useDiffStat({
    projectDirectory: conversation.projectDirectory,
    working: conversation.working,
    focus: useTerminalFocus(),
    mutations: conversation.mutations,
  })
  const docked = wide && !welcome
  const contentWidth = contentWidthOf({ width, sidebarWidth, docked })
  const chromeWidth = chromeWidthOf({ width, sidebarWidth, docked })
  const composerWidth = welcome ? welcomeCells({ width: chromeWidth }) : chromeWidth

  const router = useThreadRouter({
    localApp: props.localApp,
    cloudBridge: props.cloudBridge,
    cloudSession: props.cloudSession,
    createBridge: props.createBridge,
    containerMove,
    working: conversation.working,
    activeThreadId: conversation.threadId,
    opened: props.opened,
    onLifted: props.onLifted,
    onDescend: props.onDescend,
    onLocalSwap: conversation.handleOpenThread,
  })

  useEffect(() => {
    routeRef.current = router.handleOpen
  }, [router])

  const threads = useThreads({
    app: props.app,
    activeThreadId: conversation.threadId,
    onPick: handleOpenThread,
    listing: router.listing,
    findSandbox: router.findSandbox,
  })

  /**
   * `/resume` with a handle goes straight there, the way `atlas --resume` does; bare, it opens the
   * picker. One command, because naming a conversation and choosing one are the same intent.
   */
  const handleResumeConversation = useCallback(
    (handle: string) => {
      if (handle === '') {
        threads.handleOpen()
        return
      }

      handleOpenThread(handle)
    },
    [handleOpenThread, threads],
  )

  const accounts = useAccounts({
    accounts: props.app.accounts,
    openUrl: props.app.openUrl,
    onAccounts: props.app.models.observeAccounts,
  })

  const accountsOpen = accounts.state !== null
  const accountRows = accounts.state?.rows

  useEffect(() => {
    if (!accountsOpen) return
    for (const row of accountRows ?? []) {
      for (const account of row.accounts) void usage.refresh({ accountId: account.id })
    }
  }, [accountRows, accountsOpen, usage])

  const accountMeters = useMemo(
    () =>
      (account: Account): readonly Span[] =>
        accountMeterSpans({
          usage: usage.snapshotFor({ accountId: account.id }),
          warn: settings.usageWarn,
          now: Date.now(),
        }),
    [settings.usageWarn, usage, usageVersion],
  )

  /**
   * A signed-out boot is a steady state Atlas serves fine from the local vault, so this is an offer
   * read once ever — the marker sits beside the vault — rather than a gate or a per-boot nag.
   */
  const cloudSignInNoticed = useRef(false)
  useEffect(() => {
    if (cloudSignInNoticed.current) return
    cloudSignInNoticed.current = true
    if (props.app.cloud.session() !== null) return
    if (props.app.cloud.signInOffered()) return

    props.app.cloud.markSignInOffered()
    notify({
      key: 'cloud-sign-in-offer',
      text: 'sign in to Atlas Cloud to unlock cloud sandboxes and remote control — settings (ctrl+o) › cloud',
      tone: ENoticeTone.Info,
      ttlMs: 20_000,
    })
  }, [props.app.cloud])

  /**
   * A boot-time auth failure is usually ambient (DNS down, a revoked refresh token), so it earns a
   * chip rather than the screen. The full diagnosis waits for the first manual open of the overlay,
   * which is what the chip points at.
   */
  const { credentialNotice } = props
  const notified = useRef(false)
  const pendingCredentialNotice = useRef<string | null>(null)
  useEffect(() => {
    if (credentialNotice === null || notified.current) return

    notified.current = true
    pendingCredentialNotice.current = credentialNotice
    notify({
      key: 'credential-failure',
      text: 'A provider login is failing — press ctrl+a or run /auth.',
      tone: ENoticeTone.Warn,
      ttlMs: 23_000,
    })
  }, [credentialNotice])

  const handleOpenAccounts = useCallback(() => {
    const notice = pendingCredentialNotice.current
    pendingCredentialNotice.current = null
    accounts.handleOpen(notice ?? undefined)
  }, [accounts])

  const onboarding = useOnboarding({
    app: props.app,
    onChooseModel: handleChooseModelSetting,
    onOpenAccounts: handleOpenAccounts,
  })

  const handleRewindChoice = useCallback(
    ({ point, verb }: RewindChoice) => {
      if (verb === ERewindVerb.Fork) {
        void forkConversation({
          log: props.app.log,
          threads: props.app.threads,
          threadId: conversation.threadId,
          seq: point.seq,
          mode: EForkMode.Copy,
        })
          .then((forked) => {
            if (!forked.ok) {
              notify({ key: 'fork-refused', text: forked.reason, tone: ENoticeTone.Warn })
              return
            }
            handleOpenThread(forked.thread.id)
          })
          .catch((error: unknown) => {
            notify({
              key: 'fork-refused',
              text: error instanceof Error ? error.message : String(error),
              tone: ENoticeTone.Warn,
            })
          })
        return
      }

      if (verb === ERewindVerb.ToHere) {
        conversation.handleRewindTo(point.seq - 1)
        if (point.kind === ERewindPointKind.Said) draft.setValue(point.text)
        return
      }

      if (verb === ERewindVerb.SummariseUpTo) {
        conversation.handleCompactAround({ anchor: ECompactionAnchor.Prefix, seq: point.seq - 1 })
        return
      }

      conversation.handleCompactAround({ anchor: ECompactionAnchor.Suffix, seq: point.seq })
    },
    [conversation, draft, handleOpenThread, props.app.log, props.app.threads],
  )

  const rewind = useRewind({ events: conversation.readEvents, onPick: handleRewindChoice })

  const handleToggle = useCallback((key: string) => {
    setOpened((current) => {
      const next = new Set(current)
      if (!next.delete(key)) next.add(key)
      return next
    })
  }, [])

  /**
   * What the transcript's `⏎ open` rows promise. Nothing carries focus in the transcript, so the
   * key acts on the newest thing that can be unfolded, and only when the draft is empty.
   */
  const handleOpenNewest = useCallback((): boolean => {
    const key = newestExpandableKey(conversation.model.entries)
    if (key === null) return false

    handleToggle(key)
    return true
  }, [conversation.model.entries, handleToggle])

  const handleReloadSkills = useCallback(async (): Promise<SkillsReloaded> => {
    const before = props.app.skillRegistry.all()
    const after = await props.app.skillRegistry.reload()
    setLoadedSkills(after)
    return reloadedSkills({ before, after })
  }, [props.app.skillRegistry])

  const containerBlockers = useCallback(
    () =>
      props.app.shells.list({ threadId: conversation.threadId }).filter(isShellRunning),
    [conversation.threadId, props.app],
  )

  const cloudLift = useCloudLift({
    app: props.app,
    threadId: conversation.threadId,
    started: conversation.started,
    midTurn: conversation.turnInFlight,
    handleInterrupt: conversation.handleInterruptForMove,
    whenSettled: conversation.whenSettled,
    projectDirectory: conversation.projectDirectory,
    setLocation: execution.handleSet,
    createBridge: props.createBridge,
    preflightLift: props.preflightLift,
    capture: props.captureWorkspace,
    captureContext: props.captureContext,
    move: containerMove,
    onLifted: props.onLifted,
  })

  const applyContainerSwitch = useCallback(
    (target: EExecutionLocation) => {
      if (target === EExecutionLocation.Cloud) {
        cloudLift.handleLift()
        return
      }

      if (props.cloudSession !== null && props.cloudBridge !== null) {
        const { channel } = props.cloudSession
        const bridge = props.cloudBridge
        void descendFromCloud({
          threadId: conversation.threadId,
          target,
          midTurn: conversation.turnInFlight(),
          bridge,
          channel,
          localApp: props.localApp,
          move: containerMove,
          pullMemory: () => {
            const signedIn = props.localApp.cloud.session()
            if (signedIn === null) return Promise.resolve({ replaced: 0, conflicts: [] })
            return mergeRemoteMemoryBounded({
              session: signedIn,
              cwd: props.localApp.workspace.workspace,
            })
          },
        })
          .then((opened) => {
            containerMove.handleSettle()
            props.onDescend(opened)
          })
          .catch((error: unknown) => {
            const reason = moveFailedNotice({
              target,
              from: EExecutionLocation.Cloud,
              detail: messageOf(error),
            })
            containerMove.handleFail(reason)
            notify({
              key: 'container-switch',
              tone: ENoticeTone.Warn,
              ttlMs: NOTICE_WARN_MS,
              text: reason,
            })
          })
        return
      }

      containerMove.handleBegin({ target })
      const threadId = conversation.threadId
      for (const shell of containerBlockers()) {
        props.app.shells.kill({ shellId: shell.shellId, by: EKilledBy.ContainerSwitch, threadId })
      }

      containerMove.handleAdvance(ELocalMoveStep.Flipping)
      const from = execution.location
      execution.handleSet(target)
      if (!conversation.started) {
        containerMove.handleSettle()
        return
      }

      containerMove.handleAdvance(ELocalMoveStep.Relocating)
      void relocateSession({
        threadId,
        from,
        location: target,
        log: props.app.log,
        ids: props.app.ids,
        services: props.app.services,
        agents: props.app.agents,
      })
        .then(() => {
          containerMove.handleSettle()
          void conversation.refresh()
        })
        .catch((error: unknown) => {
          execution.handleSet(from)
          const reason = moveFailedNotice({ target, from, detail: messageOf(error) })
          containerMove.handleFail(reason)
          notify({
            key: 'container-switch',
            tone: ENoticeTone.Warn,
            ttlMs: NOTICE_WARN_MS,
            text: reason,
          })
        })
    },
    [
      cloudLift,
      containerBlockers,
      containerMove,
      conversation.refresh,
      conversation.threadId,
      conversation.started,
      conversation.turnInFlight,
      execution,
      props.app,
      props.localApp,
      props.cloudSession,
      props.cloudBridge,
      props.onDescend,
    ],
  )

  const containerGuard = useContainerGuard({ onSwitch: applyContainerSwitch })

  const handleRestart = useCallback(() => {
    if (props.onRestart === null) return

    if (shells.runningEverywhere + agents.running + services.running > 0) {
      restarting.current = true
      exitGuard.handleOpen()
      return
    }

    props.onRestart()
  }, [agents.running, exitGuard, props.onRestart, services.running, shells.runningEverywhere])

  useEffect(() => {
    if (exitGuard.state === null) restarting.current = false
  }, [exitGuard.state])

  /**
   * The falling edge of `working` is a turn ending; the slow timer covers the idle stretches —
   * the welcome screen above all, where no turn ever ends. Both are moments a stale atlas-dev
   * session may swap itself out without taking anything with it. The safety snapshot is read
   * after the stamp check resolves rather than captured up front, so a keystroke that lands in
   * between still holds the restart off. Anything less than clean falls back to the sticky notice.
   */
  const settleStale = useCallback(
    () =>
      void settleStaleness({
        staleness: staleness.current,
        releaseWatch: releaseWatch.current,
        autoRestart: settings.autoRestart,
        restart: props.onRestart,
        readSafety: () => ({
          working: conversation.working,
          interrupting: conversation.turn.interrupting,
          compacting: conversation.compacting !== null,
          containerMoveOpen: containerMove.move !== null,
          exitGuardOpen: exitGuard.state !== null,
          containerGuardOpen: containerGuard.state !== null,
          queuedMessages: props.app.pending.waitingCount(),
          runningTasks: shells.runningEverywhere + agents.running + services.running,
          draftEmpty: (draft.editor.current?.plainText ?? draft.value).length === 0,
        }),
      }),
    [
      settings.autoRestart,
      props.onRestart,
      props.app.pending,
      conversation,
      exitGuard.state,
      containerGuard.state,
      containerMove.move,
      shells.runningEverywhere,
      agents.running,
      services.running,
      draft,
    ],
  )

  const settleStaleRef = useRef(settleStale)
  useEffect(() => {
    settleStaleRef.current = settleStale
  })

  const wasWorking = useRef(false)
  useEffect(() => {
    const turnEnded = wasWorking.current && !working
    wasWorking.current = working
    if (!turnEnded) return

    settleStale()
  }, [working, settleStale])

  useEffect(() => {
    const timer = setInterval(() => settleStaleRef.current(), STALE_CHECK_MS)
    return () => clearInterval(timer)
  }, [])

  const handleContainer = useCallback(
    (asked: EExecutionLocation | EContainerAsk): string | undefined => {
      if (asked === EContainerAsk.Current) return currentLocationNotice(execution.location)
      if (asked === execution.location) return currentLocationNotice(execution.location)
      if (containerMove.move !== null) {
        return 'a move is already underway — wait for it to settle'
      }

      if (asked === EExecutionLocation.Cloud) {
        const refusal = liftRefusal({ compacting: conversation.compacting !== null })
        if (refusal !== null) return refusal
      }

      const blockers = containerBlockers()
      if (blockers.length > 0) {
        containerGuard.handleOpen({ target: asked })
        return pendingSwitchNotice({ target: asked, count: blockers.length })
      }

      applyContainerSwitch(asked)
      if (!conversation.started && asked !== EExecutionLocation.Cloud) {
        return movedLocationNotice(asked)
      }

      if (asked === EExecutionLocation.Cloud) return undefined
      return movingNotice(asked)
    },
    [
      applyContainerSwitch,
      containerBlockers,
      containerGuard,
      containerMove.move,
      conversation.compacting,
      conversation.started,
      execution,
    ],
  )

  useEffect(() => {
    if (containerGuard.state === null) return
    if (shells.running > 0) return

    containerGuard.handleApply()
  }, [containerGuard, shells.running])

  const handleQuit = useCallback(() => {
    if (cloud) {
      exitGuard.handleOpen()
      return
    }

    if (conversation.working) {
      conversation.handleInterrupt()
      return
    }

    if (shells.runningEverywhere + agents.running + services.running > 0) {
      exitGuard.handleOpen()
      return
    }

    void closeConversation()
    renderer.destroy()
  }, [agents.running, cloud, conversation, exitGuard, renderer, services.running, shells])

  const commands = useMemo(
    () =>
      localCommands({
        onChangeDirectory: conversation.handleChangeDirectory,
        onContainer: handleContainer,
        onCompact: conversation.handleCompact,
        onRewind: rewind.handleOpen,
        onShortcuts: () => setPanel(EChromePanel.Shortcuts),
        onOpenSwitcher: () => openSwitcher(),
        onOpenShells: () => shells.handleOpen(),
        onOpenAgents: agentsPicker.handleOpen,
        onShowAgentTypes: () => setPanel(EChromePanel.AgentTypes),
        onShowLostAgents: handleShowLostAgents,
        onOpenSettings: settings.handleOpen,
        onOpenAccounts: handleOpenAccounts,
        onNewConversation: handleNewConversation,
        onOpenThreads: handleResumeConversation,
        onRename: conversation.handleRename,
        onReloadSkills: handleReloadSkills,
        onShowMcp: () => mcpReport({ servers: props.app.mcp() }),
        onRestart: props.onRestart === null ? null : handleRestart,
        onQuit: handleQuit,
      }),
    [
      agentsPicker.handleOpen,
      conversation.handleChangeDirectory,
      conversation.handleCompact,
      conversation.handleRename,
      handleContainer,
      handleNewConversation,
      handleOpenAccounts,
      handleQuit,
      handleReloadSkills,
      handleRestart,
      props.app,
      props.onRestart,
      rewind.handleOpen,
      settings.handleOpen,
      shells,
      switcher.handleOpen,
      handleResumeConversation,
    ],
  )

  const skills = useMemo(() => loadedSkills.filter((skill) => skill.userInvocable), [loadedSkills])

  const specs = useMemo(() => commandSpecs({ commands, skills }), [commands, skills])

  const menus = useComposerMenus({
    specs,
    files: props.app.files,
    currentDirectory: conversation.projectDirectory,
    onComplete: draft.setValue,
  })
  const readDraft = useRef(menus.handleTextChanged)
  readDraft.current = menus.handleTextChanged

  useEffect(() => {
    readDraft.current(draft.value)
  }, [draft.value])

  const mentionSpans = useResolvedMentions({ text: draft.value, files: props.app.files })

  /**
   * The label goes in at the cursor and the buffer is read straight back, because OpenTUI's editor
   * owns the text and only mirrors it into React on its own change event.
   */
  /**
   * The token is written as a `virtual` extmark carrying its slot, which is what makes it one thing
   * to the cursor rather than a string of characters: OpenTUI's `ExtmarksController` wraps the
   * buffer's own motion and deletion — left, right, visual up and down, backspace, delete, selection
   * delete, undo and redo — so every one of them steps over the span whole instead of into it.
   */
  const cursorOffsetBefore = useRef<number | null>(null)

  const handleCursorMoved = useCallback(() => {
    const editor = draft.editor.current
    if (editor === null) return

    const offset = editor.cursorOffset
    const before = cursorOffsetBefore.current
    cursorOffsetBefore.current = offset

    const token = tokenAtOffset({ editor, offset })
    if (token === null) return

    const steppingLeft = before !== null && offset < before
    const boundary = steppingLeft ? token.start : token.end
    if (boundary === offset) return

    cursorOffsetBefore.current = boundary

    const selection = editor.getSelection()
    if (selection !== null) {
      editor.setSelection(selection.start === selection.end ? boundary : selection.start, boundary)
      return
    }

    editor.cursorOffset = boundary
  }, [draft])

  const handleAttachImage = useCallback((): boolean => {
    tokens.handleImage()
    return true
  }, [tokens])

  const [tokenSpans, setTokenSpans] = useState<readonly LiveToken[]>([])

  useEffect(() => {
    const editor = draft.editor.current
    if (editor === null) return
    setTokenSpans(liveTokens(editor))
  }, [draft])

  const highlights = useMemo(
    () => [...mentionSpans, ...tokenSpans],
    [mentionSpans, tokenSpans],
  )

  const highlightedFiles = useMemo(
    () => new Set(mentionSpans.map((mention) => mention.path)),
    [mentionSpans],
  )

  const handleSubmit = useCallback(() => {
    void (async () => {
      const editor = draft.editor.current
      const said = editor?.plainText ?? draft.value

      await tokens.settle()
      const live = editor === null ? [] : tokens.tokens()
      const readyImages = live.flatMap((token) =>
        token.slot.kind === 'image' && token.slot.image !== null
          ? [{ ...token.slot.image, ordinal: token.slot.ordinal }]
          : [],
      )

      if (said.trim().length === 0 && live.length === 0) {
        handleOpenNewest()
        return
      }

      draft.clear()
      setSends((count) => count + 1)

      const putBack = () => {
        draft.setValue(said)
        tokens.restore(readyImages)
      }

      if (agentView.viewing !== null) {
        const spoken = submissionOf({ text: said, tokens: live, load: readImageBase64 })
        void agentView.handleSay(spoken).then((refusal) => {
          if (refusal === null) return

          putBack()
          conversation.handleReportProblem(refusal)
        })
        return
      }

      void dispatchSubmission({
        text: said,
        commands,
        skills,
        working: conversation.working,
        highlightedFiles,
        ...(props.app.files === undefined
          ? {}
          : { loadFile: workspaceFileLoader(props.app.files) }),
      }).then((dispatched) => {
        if (dispatched.type === EDispatch.Queued) {
          tokens.restore(readyImages)
          conversation.handleQueueSettled(dispatched.entry)
          return
        }
        if (dispatched.type === EDispatch.Refused) {
          putBack()
          conversation.handleReportProblem(dispatched.reason)
          return
        }
        if (dispatched.type === EDispatch.Ran) {
          tokens.restore(readyImages)
          if (dispatched.notice !== undefined) notify({ text: dispatched.notice })
          return
        }
        if (dispatched.type !== EDispatch.Send) return

        const sending = submissionOf({
          text: dispatched.text,
          tokens: live,
          load: readImageBase64,
        })
        conversation.handleSend({ ...sending, context: dispatched.drafts })
      })
    })()
  }, [
    agentView,
    commands,
    conversation,
    draft,
    handleOpenNewest,
    highlightedFiles,
    props.app.files,
    skills,
    tokens,
  ])

  const surfaces = usePluginSurfaces({
    surfaces: [
      ...props.app.pluginSurfaces,
      shellsSurface({ shells }),
      servicesSurface({ services }),
      subagentsSurface({ agents, picker: agentsPicker }),
    ],
  })

  /**
   * The ladder inside `footerLayout` is what decides which pills survive the width, so the row is
   * laid out once here and both readers are given the same answer. Handing the strip the full list
   * would let a selection outlive the pill it names when the terminal is dragged narrower.
   */
  const footerRow = useMemo(
    () =>
      footerLayout({
        width: chromeWidth,
        model: card?.label ?? modelLabel(selection.ref.modelId),
        effort: selection.effort,
        items: [...locationItems, ...surfaces.footerItems],
        context: readout,
      }),
    [card, chromeWidth, locationItems, readout, selection.effort, selection.ref, surfaces.footerItems],
  )

  const footerStrip = useFooterStrip({ items: footerRow.instruments.items, draft })

  /**
   * The draft is asked for its buffer rather than its mirror because OpenTUI parses a whole input
   * burst before React re-renders, so a `?` pasted after text would otherwise read as empty.
   */
  const draftIsEmpty = useCallback(
    (): boolean => (draft.editor.current?.plainText ?? draft.value).length === 0,
    [draft],
  )

  const handleTakeBackPending = useCallback((): boolean => {
    const taken = conversation.handleTakeBackPending()
    if (taken === null) return false

    /**
     * A draft taken back out of the queue arrives as plain text, so its tokens come back without
     * the extmarks that made them whole. They are re-marked from the images it carried, or a
     * picture that survived a take-back would be the one the cursor could still walk into.
     */
    draft.setValue(taken.text)
    tokens.restore(restoredImages({ images: taken.images, text: taken.text }))
    return true
  }, [conversation, draft, tokens])

  const handleToggleSidebar = useCallback(() => setPeeking((open) => !open), [])

  const handleClosePeek = useCallback(() => setPeeking(false), [])

  useEffect(() => {
    setPeeking((open) => peekInForce({ layout, peeking: open }))
  }, [layout])

  useEffect(() => {
    if (cloud) return
    if (exitGuard.state !== null && shells.runningEverywhere + agents.running + services.running === 0) {
      exitGuard.handleDismiss()
    }
  }, [agents.running, cloud, exitGuard, services.running, shells.runningEverywhere])

  useKeyBindings(
    globalBindings({
      draftIsEmpty,
      onSubmit: handleSubmit,
      onShortcuts: () => setPanel(EChromePanel.Shortcuts),
      onTakeBackPending: handleTakeBackPending,
      onEnterFooterStrip: footerStrip.handleEnter,
      onInterrupt: conversation.handleInterrupt,
      onOpenSwitcher: () => openSwitcher(),
      onNewConversation: handleNewConversation,
      onAttachImage: handleAttachImage,
      onOpenShells: () => shells.handleOpen(),
      onCycleAgents: agents.count === 0 ? null : agentView.handleCycle,
      onToggleSidebar: wide ? null : handleToggleSidebar,
      onOpenSettings: settings.handleOpen,
      onOpenAccounts: handleOpenAccounts,
      onQuit: handleQuit,
    }),
  )

  /**
   * Escape closes the floating sidebar rather than interrupting the turn, and it wins by sitting a
   * layer above the global chord instead of by owning the keyboard — everything else the app binds
   * has to keep working while the sidebar is up.
   */
  useKeyBindings(
    overlay
      ? [
          {
            chord: 'escape',
            hint: 'close sidebar',
            layer: EKeyLayer.Block,
            group: EKeyGroup.Session,
            run: handleClosePeek,
          },
        ]
      : [],
  )

  const registry = useKeyRegistry()

  const { rewindConfirm } = conversation
  const compacting = conversation.compacting !== null
  const moving = containerMove.move !== null
  const moveFailed = containerMove.move?.failure != null

  const overlays = useMemo(
    (): readonly OverlayPresence[] => [
      covering(exitGuard.state !== null, exitGuard.handleKey),
      covering(containerGuard.state !== null, containerGuard.handleKey),
      covering(rewindConfirm.state !== null, rewindConfirm.handleKey),
      covering(rewind.state !== null, rewind.handleKey),
      { ...covering(switcher.state !== null, switcher.handleKey), porous: true },
      covering(shells.state !== null, shells.handleKey),
      covering(services.state !== null, services.handleKey),
      covering(accounts.state !== null, accounts.handleKey),
      covering(threads.state !== null, threads.handleKey),
      covering(agentsPicker.state !== null, agentsPicker.handleKey),
      { ...covering(onboarding.state !== null, onboarding.handleKey), porous: true },
      { ...covering(settings.state !== null, settings.handleKey), porous: true },
      { ...covering(footerStrip.state !== null, footerStrip.handleKey), coversTranscript: false },
      { open: compacting, coversComposer: true, coversTranscript: true },
      {
        open: moving,
        handleKey: moveFailed ? containerMove.handleKey : undefined,
        coversComposer: true,
        coversTranscript: true,
      },
      { open: overlay, coversComposer: true, coversTranscript: false },
    ],
    [
      accounts.handleKey,
      accounts.state,
      agentsPicker.handleKey,
      agentsPicker.state,
      compacting,
      containerMove.handleKey,
      exitGuard.handleKey,
      exitGuard.state,
      footerStrip.handleKey,
      footerStrip.state,
      moveFailed,
      moving,
      onboarding.handleKey,
      onboarding.state,
      overlay,
      rewind.handleKey,
      rewind.state,
      rewindConfirm.handleKey,
      rewindConfirm.state,
      services.handleKey,
      services.state,
      settings.handleKey,
      settings.state,
      shells.handleKey,
      shells.state,
      switcher.handleKey,
      switcher.state,
      threads.handleKey,
      threads.state,
    ],
  )

  const owners = useMemo(() => keyOwners(overlays), [overlays])
  const handleDismissPanel = useCallback(() => setPanel(null), [])
  const veil = useMemo(
    () => ({ shown: panel !== null, dismiss: handleDismissPanel, keys: [HELP_KEY] }),
    [handleDismissPanel, panel],
  )

  const handleKey = useOverlayKeys({ veil, owners, bindings: registry.snapshot })

  const handleKeyWithMenu = useCallback(
    (key: KeyEvent) => {
      if (props.covered) return

      if (menus.handleKey(key)) {
        key.preventDefault()
        return
      }

      handleKey(key)
    },
    [handleKey, menus, props.covered],
  )

  useKeyboard(handleKeyWithMenu)

  const overlaid = props.covered || composerCovered(overlays)

  const picturesCovered = props.covered || transcriptCovered(overlays)

  useEffect(() => {
    applyTranscriptCovered(picturesCovered)
  }, [picturesCovered])

  /**
   * What the terminal's own paste carries decides the token: nothing means a picture is waiting on
   * the clipboard, and beyond a few lines the clipboard becomes a `[Pasted text]` token so a
   * thousand-row dump does not spray the composer. A real image read resolves the empty paste; the
   * long text folds in right away.
   */
  usePaste(
    useCallback(
      (event: PasteEvent) => {
        if (overlaid) return

        const content = pastedContent(event)
        if (isEmptyPaste(event)) {
          event.preventDefault()
          event.stopPropagation()
          handleAttachImage()
          return
        }

        if (tokenizablePaste(content)) {
          event.preventDefault()
          event.stopPropagation()
          tokens.handlePasted(content)
          return
        }
      },
      [handleAttachImage, overlaid, tokens],
    ),
  )

  const sidebarModel = useMemo(
    () =>
      withSections({
        model: withCloud({
          model: withContainer({ model: agents.sidebar, container: containerPill.container }),
          cloud: containerPill.cloud,
        }),
        sections: surfaces.sidebarSections,
      }),
    [agents.sidebar, containerPill, surfaces.sidebarSections],
  )

  const placeholder = composerPlaceholder({
    addressingChild: agentView.viewing !== null,
    working: conversation.working,
  })

  return (
    <Screen>
      <SelectionSurface>
        <box flexDirection="column" width={contentWidth} flexGrow={1} flexShrink={1} flexBasis={0}>
          {welcome ? null : (
            <HeaderBar
              width={chromeWidth}
              projectDirectory={conversation.projectDirectory}
              repoRoot={repoRoot}
              diff={headerDiff}
            />
          )}
          <box flexDirection="column" flexGrow={1} flexShrink={1}>
            <box flexGrow={welcome ? 1 : 0} flexShrink={1} />
            {welcome ? (
              <WelcomeScreen
                cwd={props.app.config.cwd}
                home={homedir()}
                modelId={selection.ref.modelId}
                version={versionLabel()}
                width={contentWidth}
              />
            ) : agentView.selected === null ? (
              <Transcript
                model={conversation.model}
                width={contentWidth}
                now={conversation.now}
                cwd={conversation.projectDirectory}
                turn={conversation.turn}
                reconnecting={
                  cloudHealth?.connection?.state === EChannelConnection.Reconnecting ||
                  cloudHealth?.connection?.state === EChannelConnection.Connecting
                }
                sends={sends}
                pending={conversation.pending}
                background={background}
                waitingSince={waitingSince}
                {...(conversation.handleRetry === null
                  ? {}
                  : { onRetry: conversation.handleRetry })}
                {...(conversation.handleResume === null
                  ? {}
                  : { onResume: conversation.handleResume })}
                opened={opened}
                onToggle={handleToggle}
                {...(conversation.hasOlderHistory
                  ? { onNearTop: () => void conversation.loadOlderHistory().catch(() => undefined) }
                  : {})}
              />
            ) : (
              <SubagentTranscript
                app={props.app}
                agent={agentView.selected}
                thinking={settings.thinking}
                width={contentWidth}
                cwd={conversation.projectDirectory}
                opened={opened}
                onToggle={handleToggle}
              />
            )}
          </box>
          <NoticeStack width={chromeWidth} />
          {panel === EChromePanel.Shortcuts ? <Shortcuts width={chromeWidth} /> : null}
          {panel === EChromePanel.AgentTypes ? (
            <AgentTypes width={chromeWidth} catalog={props.app.agentTypes} />
          ) : null}
          {panel === EChromePanel.LostAgents ? (
            <LostChildren width={chromeWidth} lost={conversation.lost} />
          ) : null}
          <box
            flexDirection="column"
            flexShrink={0}
            width={composerWidth}
            alignSelf={welcome ? 'center' : 'flex-start'}
          >
            {menus.command === null ? null : (
              <CommandMenu state={menus.command} width={composerWidth} />
            )}
            {menus.file === null ? null : <FileMenu state={menus.file} width={composerWidth} />}
            {menus.cd === null ? null : (
              <FileMenu state={menus.cd} width={composerWidth} label=" Directories " />
            )}
            <Composer
              draft={draft}
              width={composerWidth}
              tone={tone}
              {...(placeholder === undefined ? {} : { placeholder })}
              maxRows={composerRows(height)}
              focused={!overlaid}
              highlights={highlights}
              onCursorMoved={handleCursorMoved}
              {...(agentView.name === null
                ? conversation.handle === null
                  ? {}
                  : { title: conversation.handle }
                : { title: `@${agentView.name}`, accent: theme.court.external })}
            />
          </box>
          <box flexGrow={welcome ? 1 : 0} flexShrink={1} />
          <Footer
            width={chromeWidth}
            model={card?.label ?? modelLabel(selection.ref.modelId)}
            layout={footerRow}
            strip={footerStrip.state}
            onActivateItem={footerStrip.handleActivate}
            {...(readout === null ? {} : { context: readout })}
          />
        </box>
        {sidebarVisible ? (
          <Sidebar
            width={overlay ? floatingSidebarWidth({ width, sidebarWidth }) : sidebarWidth}
            model={sidebarModel}
            root={projectRoot}
            worktree={sidebarWorktree}
            version={versionLabel()}
            overlay={overlay}
            shells={shells.folded}
            shellNow={shells.now}
            shellFold={shells.fold}
            services={services.folded}
            serviceNow={services.now}
            serviceFold={services.fold}
            onOpenShell={shells.handleOpen}
            onOpenService={services.handleOpen}
            onSelectSubagent={agentView.handleSelect}
            onRevokeGrant={conversation.handleRevokeGrant}
          />
        ) : null}
        <OverlayStack
          width={width}
          contentWidth={contentWidth}
          cwd={props.app.config.cwd}
          active={selection.ref}
          accountMeters={accountMeters}
          switcher={switcher}
          shells={shells}
          services={services}
          agents={agents}
          settings={settings}
          onboarding={onboarding}
          accounts={accounts}
          threads={threads}
          agentsPicker={agentsPicker}
          rewind={rewind}
          rewindConfirm={conversation.rewindConfirm}
          exitGuard={exitGuard}
          containerGuard={containerGuard}
          compacting={conversation.compacting}
          containerMove={containerMove.move}
          containerMoveNow={containerMove.now}
          onDismissContainerMove={containerMove.handleDismiss}
          now={conversation.now}
        />
      </SelectionSurface>
    </Screen>
  )
}
