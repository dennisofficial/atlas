import type {
  FactoryConnectionModel,
  FactorySurfaceAliasModel,
  FactoryTranscriptEventModel,
  FactoryWorkItemModel,
} from '../../db'
import type {
  FactoryConnectionDto,
  SurfaceAliasDto,
  TranscriptEventDto,
  WorkItemDto,
} from './factory.types'

export const toWorkItemDto = (row: FactoryWorkItemModel): WorkItemDto => ({
  id: row.id,
  organizationId: row.organizationId,
  repo: row.repo,
  sourceKind: row.sourceKind,
  status: row.status,
  orchestratorThreadId: row.orchestratorThreadId,
  orchestratorDeliveredEventId: row.orchestratorDeliveredEventId,
  driveName: row.driveName,
  revisionCycles: row.revisionCycles,
  lastActivityAt: row.lastActivityAt,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
})

export const toConnectionDto = (row: FactoryConnectionModel): FactoryConnectionDto => ({
  id: row.id,
  organizationId: row.organizationId,
  provider: row.provider,
  externalAccountId: row.externalAccountId,
  sealedCredentials: row.sealedCredentials,
  scopes: row.scopes,
  status: row.status,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
})

export const toAliasDto = (row: FactorySurfaceAliasModel): SurfaceAliasDto => ({
  id: row.id,
  workItemId: row.workItemId,
  surface: row.surface,
  externalId: row.externalId,
  kind: row.kind,
  createdAt: row.createdAt,
})

export const toTranscriptEventDto = (row: FactoryTranscriptEventModel): TranscriptEventDto => ({
  id: row.id,
  workItemId: row.workItemId,
  surface: row.surface,
  deliveryId: row.deliveryId,
  author: row.author,
  authorAssociation: row.authorAssociation,
  kind: row.kind,
  payload: row.payload,
  receivedAt: row.receivedAt,
})
