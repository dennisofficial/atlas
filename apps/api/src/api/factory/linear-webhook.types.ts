import type { RawBodyRequest } from '@nestjs/common'
import type { Request } from 'express'
import type { EFactoryEventKind } from './factory.types'

export type LinearWebhookRequest = RawBodyRequest<Request>

export interface LinearWebhookOutcome {
  handled: boolean
  workItemId?: string
  kind?: EFactoryEventKind
  appended?: boolean
}

// Every Linear webhook payload carries the workspace id as organizationId; it is the
// externalAccountId a FactoryConnection resolves on.
// https://linear.app/developers/webhooks#webhook-payload
export interface LinearPayloadBase {
  action: string
  type: string
  organizationId: string
  webhookId: string
  webhookTimestamp: number
  createdAt: string
}

export interface LinearUserPayload {
  id: string
  name: string
}

export interface LinearIssueRefPayload {
  id: string
  identifier: string
  title: string
  url: string
}

export interface LinearCommentRefPayload {
  id: string
  body: string
}

// AgentSessionEventWebhookPayload in Linear's webhook schema; action is created | prompted.
// https://linear.app/developers/agent-interaction#session-webhooks
export interface LinearAgentSessionEventPayload extends LinearPayloadBase {
  agentSession: {
    id: string
    status: string
    issue?: LinearIssueRefPayload
    comment?: LinearCommentRefPayload
    creator?: LinearUserPayload
  }
  agentActivity?: {
    id: string
    content: { type?: string; body?: string }
    user?: LinearUserPayload
  }
  appUserId: string
  oauthClientId: string
  promptContext?: string
}

export interface LinearWorkflowStatePayload {
  id: string
  name: string
  // One of backlog, unstarted, started, completed, canceled.
  type: string
}

export interface LinearIssueDataPayload {
  id: string
  identifier: string
  title: string
  state?: LinearWorkflowStatePayload
}

export interface LinearIssueEventPayload extends LinearPayloadBase {
  data: LinearIssueDataPayload
  actor?: LinearUserPayload
  url: string
}

export interface LinearCommentDataPayload {
  id: string
  body: string
  issueId?: string
  userId?: string
}

export interface LinearCommentEventPayload extends LinearPayloadBase {
  data: LinearCommentDataPayload
  actor?: LinearUserPayload
  url: string
}
