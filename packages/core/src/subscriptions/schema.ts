import { z } from 'zod'

import type { JsonValue } from '../json/value'
import { ESubscriptionActor, ESubscriptionEnd, ESubscriptionStatus } from './subscription'

export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
)

export const subscriptionCreatedSchema = z.object({
  type: z.literal('subscription-created'),
  subscriptionId: z.string().min(1),
  provider: z.string().min(1),
  target: jsonValueSchema,
  label: z.string(),
  createdBy: z.enum(ESubscriptionActor),
  expiresAt: z.string().min(1).optional(),
})

export const subscriptionChangedSchema = z.object({
  type: z.literal('subscription-changed'),
  subscriptionId: z.string().min(1),
  status: z.enum(ESubscriptionStatus),
  by: z.enum(ESubscriptionActor),
})

export const subscriptionEndedSchema = z.object({
  type: z.literal('subscription-ended'),
  subscriptionId: z.string().min(1),
  reason: z.enum(ESubscriptionEnd),
  by: z.enum(ESubscriptionActor),
})
