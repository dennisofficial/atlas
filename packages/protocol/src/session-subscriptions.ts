import { ETargetPhase, jsonValueSchema } from '@dltech/atlas-core'
import { z } from 'zod'

export const sessionSubscriptionSchema = z.strictObject({
  id: z.string().min(1),
  threadId: z.string().min(1),
  provider: z.string().min(1),
  target: jsonValueSchema,
  label: z.string(),
  events: z.array(z.string()),
  createdBy: z.string(),
  createdAt: z.string(),
  expiresAt: z.string().nullable(),
})

export type SessionSubscription = z.infer<typeof sessionSubscriptionSchema>

export const sessionSubscribeInputSchema = z.strictObject({
  sessionId: z.string().min(1),
  provider: z.string().min(1),
  target: z.string().min(1),
  events: z.array(z.string()).optional(),
  expiresAt: z.string().optional(),
})

export type SessionSubscribeInput = z.infer<typeof sessionSubscribeInputSchema>

export const subscribedTargetSchema = z.strictObject({
  phase: z.enum(ETargetPhase),
  summary: z.string().optional(),
  ended: z.boolean(),
})

export const sessionSubscribeOutputSchema = z.strictObject({
  subscription: sessionSubscriptionSchema,
  existed: z.boolean(),
  updated: z.boolean(),
  target: subscribedTargetSchema.optional(),
})

export type SessionSubscribeOutput = z.infer<typeof sessionSubscribeOutputSchema>

export const sessionUnsubscribeInputSchema = z.strictObject({
  sessionId: z.string().min(1),
  subscriptionId: z.string().min(1),
})

export type SessionUnsubscribeInput = z.infer<typeof sessionUnsubscribeInputSchema>

export const sessionUnsubscribeOutputSchema = z.strictObject({ ended: z.boolean() })

export type SessionUnsubscribeOutput = z.infer<typeof sessionUnsubscribeOutputSchema>
