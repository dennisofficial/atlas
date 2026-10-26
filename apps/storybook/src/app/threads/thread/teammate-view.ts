import { GitBranchIcon } from 'lucide-react'

import { agentDisplayLabel, EAgentDisplay } from '@dltech/atlas-ui/ai/agent-status'

import type { AppTeammate } from '../../../fixtures/teammates'
import { teammateDisplay } from '../../shell/teammate-display'
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
  onOpenParent: () => void
}

export function teammateHeader({
  teammate,
  parentTitle,
  onOpenParent,
}: TeammateHeaderInput): SessionHeaderProps {
  return {
    state: teammateSessionState(teammate),
    title: teammate.title,
    subtitle: { label: teammate.branch, icon: GitBranchIcon },
    badgeLabel: agentDisplayLabel(teammateDisplay(teammate)),
    parent: { title: parentTitle, onOpen: onOpenParent },
  }
}
