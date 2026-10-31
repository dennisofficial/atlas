import type { EReportKind } from '../agents/report'
import type { EAgentRestart } from '../agents/restart'
import type { EAgentStart } from '../agents/start'
import type { EAgentStatus } from '../agents/status'
import type { EKilledBy } from '../shells/status'
import type { ThreadId } from './ids'
import type { NoticeStamp } from './notice-stage'
import type { ERunFailureKind } from './run-failure'

export type AgentEventBody =
  | {
      type: 'agent-spawned'
      agentId: ThreadId
      agentType: string
      intent: string
      mode: EAgentStart
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
      turns: number
      toolCalls: number
      /** False for a bookkeeping ending that never wakes the parent or reaches the model; older logs also wrote it for a child that still held live work. */
      relayed?: boolean | undefined
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
      kind?: EReportKind | undefined
      notice?: NoticeStamp | undefined
    }
