import { agentDisplayLabel, EAgentDisplay } from '@dltech/atlas-ui/ai/agent-status'

import type { AppTeammate } from '../shell/fixtures/teammates'
import { teammateDisplay } from '../shell/teammate-display'
import type { SessionHeaderProps } from './session-header'
import { ESessionState } from './session-types'

export function teammateSessionState(teammate: AppTeammate): ESessionState {
  const display = teammateDisplay(teammate)
  if (display === EAgentDisplay.NeedsApproval) return ESessionState.ApprovalPending
  const live = display === EAgentDisplay.Running || display === EAgentDisplay.StartingSandbox
  return live ? ESessionState.Running : ESessionState.Idle
}

interface TeammateHeaderInput {
  teammate: AppTeammate
  parentTitle: string
  parentHref: string
}

export function teammateHeader({
  teammate,
  parentTitle,
  parentHref,
}: TeammateHeaderInput): SessionHeaderProps {
  return {
    state: teammateSessionState(teammate),
    title: teammate.title,
    badgeLabel: agentDisplayLabel(teammateDisplay(teammate)),
    parent: { title: parentTitle, href: parentHref },
  }
}
