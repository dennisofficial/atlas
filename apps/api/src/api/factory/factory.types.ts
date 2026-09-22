export const DEFAULT_ORGANIZATION_ID = 'org_atlas_default'

export enum EFactoryConnectionProvider {
  GitHub = 'github',
  Linear = 'linear',
  Slack = 'slack',
}

export enum EFactorySurface {
  Linear = 'linear',
  GitHub = 'github',
}

export enum EFactoryAliasKind {
  Ticket = 'ticket',
  Issue = 'issue',
  PullRequest = 'pull-request',
}

export enum EFactoryWorkItemStatus {
  Intake = 'intake',
  Active = 'active',
  Delivered = 'delivered',
  Stopped = 'stopped',
  Merged = 'merged',
  Closed = 'closed',
}

export enum EFactoryEventKind {
  Intake = 'intake',
  Comment = 'comment',
  Review = 'review',
  Mention = 'mention',
  StatusChange = 'status-change',
  Merged = 'merged',
  StationRequest = 'station-request',
  StationResult = 'station-result',
  Reply = 'reply',
  Delivery = 'delivery',
}

export type WorkItemDto = {
  id: string
  organizationId: string | null
  repo: string
  sourceKind: string
  status: string
  orchestratorThreadId: string | null
  orchestratorDeliveredEventId: string | null
  driveName: string | null
  revisionCycles: number
  lastActivityAt: string
  createdAt: string
  updatedAt: string
}

export type FactoryConnectionDto = {
  id: string
  organizationId: string
  provider: string
  externalAccountId: string
  sealedCredentials: string | null
  scopes: string | null
  status: string
  createdAt: string
  updatedAt: string
}

export type SurfaceAliasDto = {
  id: string
  workItemId: string
  surface: string
  externalId: string
  kind: string
  createdAt: string
}

export type TranscriptEventDto = {
  id: string
  workItemId: string
  surface: string
  deliveryId: string
  author: string | null
  authorAssociation: string | null
  kind: string
  payload: string
  receivedAt: string
}
