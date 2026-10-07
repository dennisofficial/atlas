import { ESettingId, toggleValueOf, type ThreadId } from '@dltech/atlas-core'
import { useMemo } from 'react'

import type { AgentView } from './use-agent-view'
import type { AtlasApp } from './compose'
import { useQualityHealth, type QualityHealthRead } from './use-quality-health'
import type { SettingsControl } from './use-settings'

export type QualityHealthStatusProps = {
  read: QualityHealthRead
  enabled: boolean
  recording: boolean
  threadId: ThreadId
}

export function useWorkspaceQualityHealth(args: {
  app: AtlasApp
  agentView: Pick<AgentView, 'selected' | 'scopedTo'>
  conversationThreadId: ThreadId
  settings: Pick<SettingsControl, 'state' | 'view'>
}): QualityHealthStatusProps {
  const threadId =
    args.agentView.selected?.agentId ?? args.agentView.scopedTo?.agentId ?? args.conversationThreadId
  const read = useQualityHealth({
    app: args.app,
    state: args.settings.state,
    model: args.settings.view,
    threadId,
  })
  const resolution = args.app.settings.snapshot().resolution

  return useMemo(
    () => ({
      read,
      enabled: toggleValueOf({ resolution, id: ESettingId.QualityEnabled }),
      recording: toggleValueOf({ resolution, id: ESettingId.QualityRecordExamples }),
      threadId,
    }),
    [read, resolution, threadId],
  )
}
