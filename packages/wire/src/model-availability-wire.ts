import { z } from 'zod'

import {
  availabilityKeySchema,
  availabilitySnapshotSchema,
  EProviderFailureKind,
} from './credential-availability-wire'

export enum EWaitEpisodeKind {
  Credential = 'credential',
  ControlPlane = 'control-plane',
}

export enum EModelWaitCause {
  Availability = 'availability',
  ControlPlane = 'control-plane',
}

export enum EAvailabilityControlResult {
  Applied = 'applied',
  Available = 'available',
  Unavailable = 'unavailable',
  ProbeInProgress = 'probe-in-progress',
  Stale = 'stale',
  Unreachable = 'unreachable',
}

export enum EAvailabilityAction {
  Pause = 'pause',
  RemoveManualPause = 'remove-manual-pause',
  Recheck = 'recheck',
}

const MAX_REQUEST_ID_LENGTH = 64

const threadIdSchema = z.string().min(1).brand<'ThreadId'>()

export const waitEpisodeRefWireSchema = z.discriminatedUnion('kind', [
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

export const waitingForModelWireSchema = z.strictObject({
  episode: waitEpisodeRefWireSchema,
  cause: z.enum(EModelWaitCause),
  providerId: z.string().min(1),
  accountId: z.string().min(1).nullable(),
  modelId: z.string().min(1).nullable(),
  reason: z.enum(EProviderFailureKind).nullable(),
  resetAt: z.string().min(1).nullable(),
  affectedThreadIds: z.array(threadIdSchema).readonly(),
})

export const availabilityControlRequestWireSchema = z.strictObject({
  key: availabilityKeySchema,
  expectedGeneration: z.number().int().nonnegative(),
  requestId: z.string().min(1).max(MAX_REQUEST_ID_LENGTH),
  action: z.enum(EAvailabilityAction),
})

export const availabilityControlResultWireSchema = z.strictObject({
  result: z.enum(EAvailabilityControlResult),
  snapshot: availabilitySnapshotSchema,
})

export type WaitEpisodeRefWire = z.infer<typeof waitEpisodeRefWireSchema>
export type WaitingForModelWire = z.infer<typeof waitingForModelWireSchema>
export type AvailabilityControlRequestWire = z.infer<typeof availabilityControlRequestWireSchema>
export type AvailabilityControlResultWire = z.infer<typeof availabilityControlResultWireSchema>
