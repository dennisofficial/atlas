import type { EAgentRestart } from '../agents/restart'
import type { EAgentStart } from '../agents/start'
import type { EAgentStatus } from '../agents/status'
import type { EKilledBy } from '../shells/status'
import type { ThreadId } from './ids'
import type { NoticeStamp } from './notice-stage'
import type { ERunFailureKind, RunFailure } from './run-failure'

export type AgentEventBody =
  | {
      type: 'agent-spawned'
      agentId: ThreadId
      agentType: string
      intent: string
      mode: EAgentStart
      /** The spawn step this sub-agent belongs to: the call id of the step's first tool call. */
      group?: string | undefined
      /** The tool call that asked for this sub-agent, so a re-dispatched spawn adopts it instead of starting another. */
      callId?: string | undefined
      worktree?:
        | { path: string; branch: string; base?: string | undefined; adopted?: boolean | undefined }
        | undefined
    }
  | {
      type: 'agent-ended'
      agentId: ThreadId
      agentType: string
      intent: string
      status: EAgentStatus
      killedBy?: EKilledBy | undefined
      prose: string
      failureCause?: string | undefined
      failureKind?: ERunFailureKind | undefined
      failure?: RunFailure | undefined
      turns: number
      toolCalls: number
      /** False for a bookkeeping ending that never wakes the parent or reaches the model; older logs also wrote it for a child that still held live work. */
      relayed?: boolean | undefined
      /** True when the holder stored this clean ending without waking the parent, because a sibling from the same spawn step is still running. */
      held?: boolean | undefined
      leftServices?: readonly string[] | undefined
      notice?: NoticeStamp | undefined
    }
  | {
      type: 'agent-restarted'
      agentId: ThreadId
      agentType: string
      intent: string
      via: EAgentRestart
    }
  | {
      type: 'agent-reported'
      agentId: ThreadId
      agentType: string
      intent: string
      prose: string
      senderSessionId?: string | undefined
      notice?: NoticeStamp | undefined
    }
  | {
      type: 'model-fell-back'
      role: string
      agentId?: ThreadId | undefined
      from: { ref: string; label: string }
      to: { ref: string; label: string }
      reason: EModelFallbackReason
    }

export enum EModelFallbackReason {
  ProviderNotConnected = 'provider-not-connected',
  CredentialFailed = 'credential-failed',
  FastCreditsRequired = 'fast-credits-required',
}

export type ModelFellBackBody = Extract<AgentEventBody, { type: 'model-fell-back' }>
