import type { EAgentRestart } from '../agents/restart'
import type { EAgentStart } from '../agents/start'
import type { EAgentStatus } from '../agents/status'
import type { EExecutionLocation } from '../execution/location'
import type { FilePart, ImagePart, ReasoningPart, TextPart } from '../message/parts'
import type { ERiskDimension } from '../policy/classifier/dimension'
import type { CodeQualityReviewedBody } from '../quality/schema'
import type { EGrantScope, GrantOffer } from '../policy/classifier/grant'
import type { EClassifierMode, ETriage } from '../policy/classifier/triage'
import type { EJudgment, EVerdictFault } from '../policy/classifier/verdict'
import type { EServiceStatus } from '../services/status'
import type { EKilledBy } from '../shells/status'
import type { ETldrStatus } from '../tldr/status'
import type { CallId, ThreadId } from './ids'
import type { BackgroundShellEventBody } from './shell-body'

export enum ECompactionAnchor {
  Prefix = 'prefix',
  Suffix = 'suffix',
}

export enum EDecision {
  Allow = 'allow',
  Deny = 'deny',
}

export enum EWorktreeExit {
  Keep = 'keep',
  Remove = 'remove',
}

export enum ELocationChangeCause {
  SandboxExpired = 'sandbox-expired',
}

export enum EOperatorInputOutcome {
  Delivered = 'delivered',
  Undelivered = 'undelivered',
  Cancelled = 'cancelled',
}

export enum EMessageOrigin {
  Operator = 'operator',
  ParentAgent = 'parent-agent',
  PeerAgent = 'peer-agent',
}

export enum EPullRequestState {
  Open = 'open',
  Draft = 'draft',
  Merged = 'merged',
  Closed = 'closed',
}

export const saidBy = (said: { via?: EMessageOrigin | undefined }): EMessageOrigin =>
  said.via ?? EMessageOrigin.Operator

export enum EAssistantPlaceholder {
  NoContent = 'no-content',
}

export type AssistantPart = TextPart | ReasoningPart

export type SaidImage = {
  path: string
  mediaType: string
  data: string
  width?: number | undefined
  height?: number | undefined
}

export type SaidFile = {
  path: string
  mediaType: string
  data: string
  filename?: string | undefined
}

export type EventBody =
  | {
      type: 'user-said'
      text: string
      via?: EMessageOrigin | undefined
      images?: readonly SaidImage[] | undefined
      files?: readonly SaidFile[] | undefined
    }
  | {
      type: 'assistant-said'
      parts: readonly AssistantPart[]
      interrupted?: boolean | undefined
      placeholder?: EAssistantPlaceholder | undefined
    }
  | { type: 'tool-called'; callId: CallId; name: string; input?: unknown; ordinal: number }
  | {
      type: 'tool-result'
      callId: CallId
      name: string
      output?: unknown
      modelText?: string | undefined
      modelParts?: readonly (TextPart | ImagePart | FilePart)[] | undefined
      error?: { message: string } | undefined
      interrupted?: boolean | undefined
      qualityReviews?: readonly CodeQualityReviewedBody[] | undefined
    }
  | { type: 'tool-denied'; callId: CallId; name: string; reason: string; interrupted?: boolean | undefined }
  | { type: 'approval-requested'; callId: CallId; reason: string }
  | { type: 'approval-answered'; callId: CallId; decision: EDecision; editedInput?: unknown }
  | { type: 'context-loaded'; slot: string; key: string; content: string; triggeredBy?: string | undefined }
  | { type: 'nudge'; text: string; lifetimeSteps: number }
  | {
      type: 'loop-watch-verdict'
      consulted: boolean
      looping: boolean
      probability?: number | undefined
      loopStartSeq?: number | undefined
      steps: number
      fault?: string | undefined
    }
  | {
      type: 'worktree-entered'
      path: string
      branch: string
      base?: string | undefined
      adopted?: boolean | undefined
    }
  | { type: 'worktree-exited'; path: string; action: EWorktreeExit; returnTo?: string | undefined }
  | {
      type: 'location-changed'
      from: EExecutionLocation
      to: EExecutionLocation
      cwd?: string | undefined
      remoteUrl?: string | null | undefined
      branch?: string | null | undefined
      cause?: ELocationChangeCause | undefined
    }
  | {
      type: 'parked'
      reason: string
      turnRunning: boolean
      childrenRunning: number
      shellsRunning: number
      servicesRunning: number
      clientsAttached: number
    }
  | {
      type: 'operator-input-requested'
      requestId: string
      description: string
      url?: string | undefined
      path: string
    }
  | {
      type: 'operator-input-resolved'
      requestId: string
      outcome: EOperatorInputOutcome
      bytes?: number | undefined
    }
  | { type: 'directory-changed'; path: string; repo?: string | null | undefined }
  | {
      type: 'pull-request-linked'
      number: number
      url: string
      repo: string
      branch: string
    }
  | BackgroundShellEventBody
  | {
      type: 'service-started'
      serviceId: string
      command: string
      description?: string | undefined
      bootId?: string | undefined
    }
  | {
      type: 'service-ended'
      serviceId: string
      command: string
      description?: string | undefined
      bootId?: string | undefined
      status: EServiceStatus
      killedBy?: EKilledBy | undefined
      exitCode?: number | undefined
      logPath?: string | undefined
      tail: string
    }
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
      turns: number
      toolCalls: number
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
    }
  | {
      type: 'history-compacted'
      anchor: ECompactionAnchor
      fromSeq: number
      throughSeq: number
      summary: string
      replaced: number
    }
  | {
      type: 'classifier-judged'
      callId: CallId
      mode: EClassifierMode
      triage: ETriage
      judgment: EJudgment
      dimensions: readonly ERiskDimension[]
      judgedDimension?: ERiskDimension | undefined
      verdictFault?: EVerdictFault | undefined
      judgeFault?: string | undefined
      signalIds: readonly string[]
      details?: readonly string[] | undefined
      grantables?: readonly GrantOffer[] | undefined
      reason: string
      consulted: boolean
      wouldAsk?: boolean | undefined
      elapsedMs: number
    }
  | {
      type: 'permission-granted'
      grantId: string
      dimensions: readonly ERiskDimension[]
      scope: EGrantScope
      subject: string
      reason: string
    }
  | { type: 'permission-revoked'; grantId: string }
  | CodeQualityReviewedBody
  | {
      type: 'tldr-written'
      anchorSeq: number
      throughSeq: number
      text: string
      modelId: string
      status?: ETldrStatus | undefined
    }

export type EventDraft = EventBody

export type EventType = EventBody['type']

export const SURVIVES_SUMMARY: readonly EventType[] = [
  'context-loaded',
  'code-quality-reviewed',
  'permission-granted',
  'permission-revoked',
  'pull-request-linked',
  'location-changed',
]

export const survivesSummary = (type: EventType): boolean => SURVIVES_SUMMARY.includes(type)
