import { z } from 'zod'

import { jsonValueSchema } from '../json/schema'
import { ESubscriptionActor, ESubscriptionEnd, ESubscriptionStatus } from './subscription'

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
