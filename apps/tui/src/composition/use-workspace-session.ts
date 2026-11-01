import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { DEFAULT_IMAGE_TIER } from '@dltech/atlas-core'
import { composerDraftScope, EConnectionView } from '@dltech/atlas-harness'

import { newestExpandableKey, type PendingSaid } from '../store'
import { restoredImages } from '../ui/draft-images'
import { useDraft } from '../ui/hooks/use-draft'
import { useDraftTokens } from '../ui/hooks/use-draft-tokens'
import { useSince } from '../ui/hooks/use-since'
import { channelTakingTurns } from './cloud/channel-ready'
import { pasteDirectoryOf } from './paste-directory'
import { unplacedThread } from './cloud/use-unborn-thread'
import { useComposerDraftSync } from './use-composer-draft-sync'
import { useProjectPrompt } from './use-project-prompt'
import { useThreadBirth } from './use-thread-birth'
import { useCloudHealth } from './use-cloud-connection'
import { useContainerMove } from './use-container-move'
import { useConversation } from './use-conversation'
import type { SettingsControl } from './use-settings'
import type { useWorkspaceExit } from './use-workspace-exit'
import type { WorkspaceProps } from './workspace-props'

const SOCKET_DOWN_REFUSAL = "the pod socket is down — esc will interrupt once it's back"

const SANDBOX_WAKING_REFUSAL = 'the pod is still waking — esc will interrupt once it is up'

const SANDBOX_UPDATING_REFUSAL = 'the pod is updating — esc will interrupt once it is back'

type SessionProps = Pick<
  WorkspaceProps,
  | 'app'
  | 'localApp'
  | 'opened'
  | 'clipboard'
  | 'cloudSession'
  | 'cloudStores'
  | 'draftText'
  | 'onDraftSource'
  | 'onLeaveCloud'
  | 'onMoveStep'
  | 'createBridge'
  | 'preflightBirth'
  | 'onReload'
>

export function useWorkspaceSession(args: {
  props: SessionProps
  settings: Pick<
    SettingsControl,
    'paceReveal' | 'thinking' | 'tldrStatus' | 'handleOpenCloudSignIn'
  >
  exit: Pick<ReturnType<typeof useWorkspaceExit>, 'exitGuard'>
}) {
  const { props, settings, exit } = args

  const draft = useDraft(props.draftText)

  useEffect(() => {
    props.onDraftSource(() => ({
      threadId: props.opened.threadId,
      text: draft.editor.current?.plainText ?? draft.value,
    }))
  }, [props.onDraftSource, props.opened.threadId, draft])

  const handleFocusComposer = useCallback(() => draft.editor.current?.focus(), [draft])

  const restoreUndone = useRef<(said: PendingSaid) => void>(() => undefined)
  const handleUndone = useCallback((said: PendingSaid) => restoreUndone.current(said), [])

  const containerMove = useContainerMove(
    props.onMoveStep === undefined ? undefined : { onStep: props.onMoveStep },
  )

  const cloudHealth = useCloudHealth({ app: props.app, session: props.cloudSession })

  const cloudView = cloudHealth?.view.state ?? null
  const reconnectingSince = useSince(
    cloudView === EConnectionView.Reconnecting || cloudView === EConnectionView.Updating,
  )

  const interruptRefusal = useCallback((): string | null => {
    const state = cloudHealth?.view.state
    if (state === undefined || state === EConnectionView.Connected) return null
    if (state === EConnectionView.Waking) return SANDBOX_WAKING_REFUSAL
    if (state === EConnectionView.Updating) return SANDBOX_UPDATING_REFUSAL
    return SOCKET_DOWN_REFUSAL
  }, [cloudHealth])

  const cloudSession = props.cloudSession
  const wakeCloud = useMemo(
    () => (cloudSession === null ? null : () => cloudSession.wake()),
    [cloudSession],
  )

  const moveInFlight = containerMove.move !== null && containerMove.move.failure === null

  const channelReady = channelTakingTurns(cloudHealth?.view)

  const conversation = useConversation({
    app: props.app,
    threads: props.cloudStores?.threads ?? props.app.threads,
    opened: props.opened,
    paceReveal: settings.paceReveal,
    thinking: settings.thinking,
    tldrStatus: settings.tldrStatus,
    onUndone: handleUndone,
    canWake: exit.exitGuard.state === null && !moveInFlight,
    interruptRefusal,
    channelReady,
    frozen: cloudView === EConnectionView.Disconnected,
    cloudView,
    wakeCloud,
  })

  const tokens = useDraftTokens({
    editor: draft.editor,
    read: props.clipboard,
    directory: pasteDirectoryOf(conversation.threadId),
    tier: props.app.models.cardFor(props.app.model.choice().ref)?.imageTier ?? DEFAULT_IMAGE_TIER,
  })

  useEffect(() => {
    restoreUndone.current = (said) => {
      tokens.restore({
        text: said.text,
        images: restoredImages({ images: said.images, text: said.text }),
      })
    }
  }, [tokens])

  const [opened, setOpened] = useState<ReadonlySet<string>>(() => new Set<string>())

  const handleToggle = useCallback((key: string) => {
    setOpened((current) => {
      const next = new Set(current)
      if (!next.delete(key)) next.add(key)
      return next
    })
  }, [])

  const handleOpenNewest = useCallback((): boolean => {
    const key = newestExpandableKey(conversation.model.entries)
    if (key === null) return false

    handleToggle(key)
    return true
  }, [conversation.model.entries, handleToggle])

  const projectPrompt = useProjectPrompt()

  const unplaced = unplacedThread({ opened: props.opened, started: conversation.started })

  useComposerDraftSync({
    cloud: props.app.cloud,
    scope: composerDraftScope({
      threadId: conversation.threadId,
      cloudThread: props.cloudSession !== null,
      unborn: unplaced,
    }),
    value: draft.value,
    editor: draft.editor,
    tokens,
  })

  const birth = useThreadBirth({
    projectPrompt,
    app: props.localApp,
    owner: props.localApp.sessionOwner,
    containerMove,
    createBridge: props.createBridge,
    preflightBirth: props.preflightBirth,
    onSignInRequired: settings.handleOpenCloudSignIn,
    adopt: (opened) => props.onLeaveCloud(opened),
    onReload: props.onReload,
    threadId: conversation.threadId,
    unplaced,
    attached: props.cloudSession !== null,
    onArrival: (send) => conversation.handleSend(send),
  })

  const handleNewConversation = useCallback(() => {
    // A queued /new runs after the turn settles; a live read, not the render's boolean — the
    // settled-command entry closes over this callback while the turn is still in flight.
    if (conversation.turnInFlight()) return
    draft.clear()
    birth.handleNewThread()
  }, [birth, conversation, draft])

  return {
    draft,
    tokens,
    conversation,
    containerMove,
    projectPrompt,
    cloudHealth,
    cloud: { view: cloudView, wake: wakeCloud },
    reconnectingSince,
    opened,
    handleToggle,
    handleOpenNewest,
    handleFocusComposer,
    handleNewConversation,
    handleUnbornSend: birth.handleUnbornSend,
  }
}
