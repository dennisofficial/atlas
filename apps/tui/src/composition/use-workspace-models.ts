import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import type { MutableRefObject } from 'react'

import { contextPressure, type ModelCard } from '@dltech/atlas-core'
import {
  settingModelRef,
  suggestedModelRef,
  type CloudStores,
  type ModelSelection,
} from '@dltech/atlas-harness'

import type { FooterContext } from '../ui/components/footer'
import type { FooterMeter } from '../ui/usage-meters'
import type { AtlasApp } from './compose'
import type { AgentView } from './use-agent-view'
import type { Conversation } from './use-conversation'
import type { SettingsControl } from './use-settings'
import { settingTarget, useSwitcher, type SwitcherViewed } from './use-switcher'
import { useTeammateThread } from './use-teammate-scope'
import { useThreadModel } from './use-thread-model'
import { useUsageMeters } from './use-usage-meters'
import { useViewModel } from './use-view-model'

export type ModelChoiceRelay = {
  open: MutableRefObject<((id: string) => void) | null>
  handleChoose: (id: string) => void
}

export function useModelChoiceRelay(): ModelChoiceRelay {
  const open = useRef<((id: string) => void) | null>(null)
  const handleChoose = useCallback((id: string) => {
    open.current?.(id)
  }, [])

  return { open, handleChoose }
}

export function useWorkspaceModels(args: {
  app: AtlasApp
  cloudStores: CloudStores | null
  settings: Pick<
    SettingsControl,
    'footerMeters' | 'usageWarn' | 'modelFavourites' | 'handlePinModels'
  >
  conversation: Pick<Conversation, 'threadId' | 'threadModel' | 'started'>
  relay: ModelChoiceRelay
}) {
  const { app, cloudStores, settings, conversation, relay } = args
  const accountsVersion = useSyncExternalStore(app.models.subscribe, app.models.version)

  const threadModel = useThreadModel({
    app,
    threads: cloudStores?.threads ?? app.threads,
    lifted: cloudStores !== null,
    threadId: conversation.threadId,
    stored: conversation.threadModel,
    started: conversation.started,
  })

  const { selection } = threadModel

  const metered = app.models.subscribed(selection.ref.providerId)

  const meters = useUsageMeters({
    usage: app.usage,
    metered,
    show: settings.footerMeters,
    warn: settings.usageWarn,
  })

  const heldSettingRef = useCallback(
    (id: string) => {
      const settled = app.settings.snapshot().resolution
      return (
        settingModelRef({ id, settled, catalogue: app.models }) ??
        suggestedModelRef({ id, settled, catalogue: app.models })
      )
    },
    [app],
  )

  const viewedPicker = useRef<SwitcherViewed | undefined>(undefined)

  const switcher = useSwitcher({
    catalogue: app.models,
    accountsVersion,
    active: selection.ref,
    effort: selection.effort,
    fallback: threadModel.fallback,
    settingRef: heldSettingRef,
    favourites: settings.modelFavourites,
    onPick: threadModel.handlePicked,
    onPin: settings.handlePinModels,
    viewed: viewedPicker.current,
  })

  const openSwitcher = switcher.handleOpen

  useEffect(() => {
    relay.open.current = (id) => {
      const definition = app.settings.definitions.find((one) => one.id === id)
      openSwitcher(settingTarget({ id, label: definition?.label ?? id }))
    }
  }, [openSwitcher, app.settings.definitions])

  return { selection, meters, switcher, viewedPicker }
}

const readoutOf = (args: {
  card: ModelCard | undefined
  used: number
  meters: readonly FooterMeter[]
}): FooterContext => {
  const { card } = args

  if (card === undefined) return { percent: 0, measured: false, meters: args.meters }

  const pressure = contextPressure({ used: args.used, window: card.contextWindow })
  return { percent: pressure.percent, tokensUsed: pressure.used, meters: args.meters }
}

export function useViewedAgent(args: {
  app: AtlasApp
  conversation: Pick<Conversation, 'threadId' | 'contextTokens'>
  agentView: Pick<AgentView, 'selected' | 'scopedTo'>
  selection: ModelSelection
  meters: readonly FooterMeter[]
  viewedPicker: MutableRefObject<SwitcherViewed | undefined>
}) {
  const { app, conversation, agentView, selection, meters, viewedPicker } = args

  const teammateThread = useTeammateThread({ app, teammate: agentView.scopedTo })

  const scopedWorktree =
    agentView.scopedTo === null ? null : (teammateThread?.worktree?.path ?? null)
  const scopedRepo = agentView.scopedTo === null ? null : (teammateThread?.repo ?? null)

  const viewedAgent = agentView.selected ?? agentView.scopedTo
  const viewModel = useViewModel({
    app,
    threadId: viewedAgent?.agentId ?? conversation.threadId,
    model: viewedAgent?.model,
    enabled: viewedAgent !== null,
  })

  const viewedSelection = viewedAgent === null ? selection : viewModel.selection
  const viewedCard = viewedSelection === null ? undefined : app.models.cardFor(viewedSelection.ref)
  const viewedContextTokens = viewedAgent?.context?.tokens ?? conversation.contextTokens
  const readout = useMemo(
    () =>
      viewedSelection === null
        ? null
        : readoutOf({ card: viewedCard, used: viewedContextTokens, meters }),
    [viewedCard, viewedContextTokens, meters, viewedSelection],
  )

  viewedPicker.current =
    viewedAgent === null || viewedSelection === null
      ? undefined
      : {
          ref: viewedSelection.ref,
          effort: viewedSelection.effort,
          onPick: (choice) => viewModel.handlePicked({ choice }),
        }

  return { viewedSelection, viewedCard, readout, scopedWorktree, scopedRepo }
}
