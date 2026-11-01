import {
  CircleCheckIcon,
  CirclePauseIcon,
  CircleXIcon,
  LoaderCircleIcon,
  ShieldAlertIcon,
  type LucideIcon,
} from 'lucide-react'

import { cn } from '#lib/utils'

export enum EAgentDisplay {
  StartingSandbox = 'starting-sandbox',
  Running = 'running',
  NeedsApproval = 'needs-approval',
  Paused = 'paused',
  WaitingForModel = 'waiting-for-model',
  Failed = 'failed',
  Done = 'done',
}

interface Presentation {
  label: string
  tone: string
  Icon: LucideIcon
}

const PRESENTATION: Record<EAgentDisplay, Presentation> = {
  [EAgentDisplay.StartingSandbox]: {
    label: 'Starting sandbox',
    tone: 'animate-spin text-muted-foreground',
    Icon: LoaderCircleIcon,
  },
  [EAgentDisplay.Running]: {
    label: 'Running',
    tone: 'animate-spin text-foreground',
    Icon: LoaderCircleIcon,
  },
  [EAgentDisplay.NeedsApproval]: {
    label: 'Needs approval',
    tone: 'text-warning',
    Icon: ShieldAlertIcon,
  },
  [EAgentDisplay.Paused]: {
    label: 'Paused',
    tone: 'text-muted-foreground',
    Icon: CirclePauseIcon,
  },
  [EAgentDisplay.WaitingForModel]: {
    label: 'Waiting for model',
    tone: 'text-muted-foreground',
    Icon: CirclePauseIcon,
  },
  [EAgentDisplay.Failed]: {
    label: 'Failed',
    tone: 'text-destructive',
    Icon: CircleXIcon,
  },
  [EAgentDisplay.Done]: {
    label: 'Done',
    tone: 'text-success',
    Icon: CircleCheckIcon,
  },
}

export function agentDisplayLabel(display: EAgentDisplay): string {
  return PRESENTATION[display].label
}

export function needsAttention(display: EAgentDisplay): boolean {
  return display === EAgentDisplay.NeedsApproval || display === EAgentDisplay.Failed
}

export interface AgentStatusIconProps {
  display: EAgentDisplay
  className?: string
}

export function AgentStatusIcon({ display, className }: AgentStatusIconProps) {
  const { label, tone, Icon } = PRESENTATION[display]
  return <Icon role="img" aria-label={label} className={cn('size-4 shrink-0', tone, className)} />
}
