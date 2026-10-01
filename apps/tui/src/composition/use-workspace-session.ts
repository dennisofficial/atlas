import { useCallback, useEffect, useRef, useState } from 'react'

import { DEFAULT_IMAGE_TIER } from '@dltech/atlas-core'
import { EChannelConnection } from '@dltech/atlas-harness'

import { newestExpandableKey, type PendingSaid } from '../store'
import { restoredImages } from '../ui/draft-images'
import { useDraft } from '../ui/hooks/use-draft'
import { useDraftTokens } from '../ui/hooks/use-draft-tokens'
import { pasteDirectoryOf } from './paste-directory'
import { unstartedConversation } from './open-conversation'
import { useCloudSession } from './use-cloud-session'
import { useContainerMove } from './use-container-move'
import { useConversation } from './use-conversation'
import type { SettingsControl } from './use-settings'
import type { useWorkspaceExit } from './use-workspace-exit'
import type { WorkspaceProps } from './workspace-props'

const SOCKET_DOWN_REFUSAL = "the sandbox socket is down — esc will interrupt once it's back"

const SANDBOX_PARKED_REFUSAL = 'the sandbox is parked — send a message to wake it first'

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
  | 'onDescend'
  | 'onMoveStep'
>

export function useWorkspaceSession(args: {
  props: SessionProps
  settings: Pick<SettingsControl, 'paceReveal' | 'thinking' | 'tldrStatus'>
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

  const cloudHealth = useCloudSession({ session: props.cloudSession })

  const interruptRefusal = useCallback((): string | null => {
    const state = cloudHealth?.connection?.state
    if (state === undefined || state === EChannelConnection.Open) return null
    if (state === EChannelConnection.Parked) return SANDBOX_PARKED_REFUSAL
    return SOCKET_DOWN_REFUSAL
  }, [cloudHealth])

  const moveInFlight = containerMove.move !== null && containerMove.move.failure === null

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
    frozen: cloudHealth?.connection?.state === EChannelConnection.Closed,
  })

  const tokens = useDraftTokens({
    editor: draft.editor,
    read: props.clipboard,
    directory: pasteDirectoryOf(conversation.threadId),
    tier: props.app.models.cardFor(props.app.model.choice().ref)?.imageTier ?? DEFAULT_IMAGE_TIER,
  })

  useEffect(() => {
    restoreUndone.current = (said) => {
      draft.setValue(said.text)
      tokens.restore(restoredImages({ images: said.images, text: said.text }))
    }
  }, [draft, tokens])

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

  const { working } = conversation

  const handleNewConversation = useCallback(() => {
    draft.clear()
    if (props.cloudSession === null) {
      conversation.handleNewConversation()
      return
    }
    if (working) return

    props.onDescend(unstartedConversation({ ids: props.localApp.ids }))
  }, [conversation, draft, working, props.cloudSession, props.localApp, props.onDescend])

  return {
    draft,
    tokens,
    conversation,
    containerMove,
    cloudHealth,
    opened,
    handleToggle,
    handleOpenNewest,
    handleFocusComposer,
    handleNewConversation,
  }
}
