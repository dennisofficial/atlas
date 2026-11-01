import { z } from 'zod'

import { availabilityKeySchema, type AvailabilityKey } from '../credentials/credential-availability'
import { threadIdSchema, type ThreadId } from '../events/ids'
import { EProviderFailureKind } from '../models/provider-failure'

export enum EWaitEpisodeKind {
  Credential = 'credential',
  ControlPlane = 'control-plane',
}

export type CredentialWaitEpisodeRef = {
  kind: EWaitEpisodeKind.Credential
  key: AvailabilityKey
  generation: number
}

export type ControlPlaneWaitEpisodeRef = {
  kind: EWaitEpisodeKind.ControlPlane
  code: string
  providerId: string
  modelId: string | null
}

export type WaitEpisodeRef = CredentialWaitEpisodeRef | ControlPlaneWaitEpisodeRef

export enum EModelWaitCause {
  Availability = 'availability',
  ControlPlane = 'control-plane',
}

export type WaitingForModel = {
  episode: WaitEpisodeRef
  cause: EModelWaitCause
  providerId: string
  accountId: string | null
  modelId: string | null
  reason: EProviderFailureKind | null
  resetAt: string | null
  affectedThreadIds: readonly ThreadId[]
}

export enum EAvailabilityControlResult {
  Applied = 'applied',
  Available = 'available',
  Unavailable = 'unavailable',
  ProbeInProgress = 'probe-in-progress',
  Stale = 'stale',
  Unreachable = 'unreachable',
}

export const waitEpisodeRefSchema: z.ZodType<WaitEpisodeRef> = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal(EWaitEpisodeKind.Credential),
    key: availabilityKeySchema,
    generation: z.number().int().nonnegative(),
  }),
  z.strictObject({
    kind: z.literal(EWaitEpisodeKind.ControlPlane),
    code: z.string().min(1),
    providerId: z.string().min(1),
    modelId: z.string().min(1).nullable(),
  }),
])

export const modelWaitCauseSchema: z.ZodType<EModelWaitCause> = z.enum(EModelWaitCause)

export const availabilityControlResultSchema: z.ZodType<EAvailabilityControlResult> = z.enum(
  EAvailabilityControlResult,
)

export const waitingForModelSchema: z.ZodType<WaitingForModel> = z.strictObject({
  episode: waitEpisodeRefSchema,
  cause: modelWaitCauseSchema,
  providerId: z.string().min(1),
  accountId: z.string().min(1).nullable(),
  modelId: z.string().min(1).nullable(),
  reason: z.enum(EProviderFailureKind).nullable(),
  resetAt: z.string().min(1).nullable(),
  affectedThreadIds: z.array(threadIdSchema),
})
