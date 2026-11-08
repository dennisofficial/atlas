import type { Attachment } from '../attachments/attachment'
import type { DiagramRepairedBody } from '../diagrams/diagram-body'
import type { EExecutionLocation } from '../execution/location'
import type { ReasoningPart, TextPart, UserContentPart } from '../message/parts'
import type { CodeQualityReviewedBody } from '../quality/schema'
import type { EServiceStatus } from '../services/status'
import type { EModelWaitCause, WaitEpisodeRef, WaitingForModel } from '../model-recovery/waiting'
import type { EKilledBy } from '../shells/status'
import type { EFinishReason, ModelUsage } from '../stream/chunk'
import type { ETldrStatus } from '../tldr/status'
import type { CallId, ThreadId } from './ids'
import type { NoticeStamp } from './notice-stage'
import type { RunFailure } from './run-failure'
import type { AgentEventBody } from './agent-body'
import type { PolicyEventBody } from './policy-body'
import type { PrEventBody } from './pr-body'
import type { BackgroundShellEventBody } from './shell-body'
import type { SubscriptionEventBody } from './subscription-body'

/** What the provider reported for the model call that wrote this event, and the window it ran in. */
export type StepReading = ModelUsage & {
  contextWindow?: number | undefined
  providerId?: string | undefined
  modelId?: string | undefined
}

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

export enum EPrEventKind {
  Comment = 'comment',
  Review = 'review',
  ReviewComment = 'review-comment',
  Verdict = 'verdict',
  Mergeability = 'mergeability',
  State = 'state',
}

export enum EPrReviewState {
  Approved = 'approved',
  ChangesRequested = 'changes_requested',
  Commented = 'commented',
}

export enum EPrVerdict {
  Green = 'green',
  Failed = 'failed',
}

export const saidBy = (said: { via?: EMessageOrigin | undefined }): EMessageOrigin =>
  said.via ?? EMessageOrigin.Operator

export enum EAssistantPlaceholder {
  NoContent = 'no-content',
}

export type AssistantPart = TextPart | ReasoningPart

import type { SaidFile, SaidImage, SaidMedia, SaidUpload } from '../attachments/legacy-said'

export type EventBody =
  | {
      type: 'user-said'
      text: string
      via?: EMessageOrigin | undefined
      requestId?: string | undefined
      inboxId?: number | undefined
      images?: readonly SaidImage[] | undefined
      files?: readonly SaidFile[] | undefined
      uploads?: readonly SaidUpload[] | undefined
      media?: readonly SaidMedia[] | undefined
      attachments?: readonly Attachment[] | undefined
    }
  | {
      type: 'assistant-said'
      parts: readonly AssistantPart[]
      interrupted?: boolean | undefined
      placeholder?: EAssistantPlaceholder | undefined
      aborted?: 'handoff' | undefined
      fast?: true | undefined
      finish?: EFinishReason | undefined
      usage?: StepReading | undefined
    }
  | {
      type: 'tool-called'
      callId: CallId
      name: string
      input?: unknown
      ordinal: number
      usage?: StepReading | undefined
    }
  | { type: 'tool-dispatched'; callId: CallId; name: string; bootId?: string | undefined }
  | {
      type: 'tool-result'
      callId: CallId
      name: string
      output?: unknown
      modelText?: string | undefined
      modelParts?: readonly UserContentPart[] | undefined
      error?: { message: string } | undefined
      interrupted?: boolean | undefined
      qualityReviews?: readonly CodeQualityReviewedBody[] | undefined
    }
  | {
      type: 'tool-denied'
      callId: CallId
      name: string
      reason: string
      interrupted?: boolean | undefined
    }
  | { type: 'approval-requested'; callId: CallId; reason: string }
  | { type: 'approval-answered'; callId: CallId; decision: EDecision; editedInput?: unknown }
  | {
      type: 'context-loaded'
      slot: string
      key: string
      content: string
      triggeredBy?: string | undefined
    }
  | { type: 'nudge'; text: string; lifetimeSteps: number }
  | { type: 'sandbox-setup-reported'; text: string; failed: boolean }
  | {
      type: 'turn-failed'
      message: string
      modelId?: string | undefined
      providerId?: string | undefined
    }
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
      type: 'rotated'
      predecessor: ThreadId
      handoffPath: string
      instructions?: string | undefined
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
  | { type: 'checkout-observed'; path: string; branch: string | null; detached: boolean }
  | BackgroundShellEventBody
  | AgentEventBody
  | PolicyEventBody
  | SubscriptionEventBody
  | PrEventBody
  | DiagramRepairedBody
  | {
      type: 'service-started'
      serviceId: string
      name?: string | undefined
      port?: number | undefined
      declarationHash?: string | undefined
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
      restarting?: true | undefined
      notice?: NoticeStamp | undefined
    }
  | {
      type: 'history-compacted'
      anchor: ECompactionAnchor
      fromSeq: number
      throughSeq: number
      summary: string
      replaced: number
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
  | { type: 'run-failed'; failure: RunFailure }
  | { type: 'run-failure-dismissed'; failureSeq: number }
  | { type: 'model-waiting'; waiting: WaitingForModel }
  | { type: 'model-wait-cleared'; episode: WaitEpisodeRef; cause: EModelWaitCause }

export type EventDraft = EventBody

export type EventType = EventBody['type']
