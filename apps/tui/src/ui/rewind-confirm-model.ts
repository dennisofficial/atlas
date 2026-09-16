import type { RewindKill } from '@dltech/atlas-harness'

import { subagentLabel } from '../store/subagent-row'
import { AGENT_TAG, SERVICE_TAG, SHELL_TAG } from './exit-guard-model'
import { serviceNameLabel } from './services-model'
import { shellNameLabel } from './shells-model'

export type RewindConfirmRow = {
  id: string
  tag: string
  label: string
  running: boolean
}

export type RewindConfirmState = {
  toSeq: number
  rows: readonly RewindConfirmRow[]
}

const rowOf = (kill: RewindKill): RewindConfirmRow => {
  if (kill.kind === 'agent') {
    return {
      id: kill.agentId,
      tag: AGENT_TAG,
      label: subagentLabel(kill),
      running: kill.running,
    }
  }
  if (kill.kind === 'shell') {
    return {
      id: kill.shellId,
      tag: SHELL_TAG,
      label: shellNameLabel({ command: kill.command ?? kill.shellId, description: kill.description }),
      running: kill.running,
    }
  }
  return {
    id: kill.serviceId,
    tag: SERVICE_TAG,
    label: serviceNameLabel({ command: kill.command ?? kill.serviceId, description: kill.description ?? '' }),
    running: kill.running,
  }
}

export function openRewindConfirm(args: {
  toSeq: number
  kills: readonly RewindKill[]
}): RewindConfirmState {
  return { toSeq: args.toSeq, rows: args.kills.map(rowOf) }
}
