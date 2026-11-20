import { z } from 'zod'

import { ESubscriptionStatus } from './subscription'

export enum ESubscriptionTone {
  Neutral = 'neutral',
  Open = 'open',
  Merged = 'merged',
  Closed = 'closed',
  Failed = 'failed',
  Running = 'running',
}

export const subscriptionPresentationSchema = z.strictObject({
  icon: z.string().min(1),
  tone: z.enum(ESubscriptionTone),
  title: z.string(),
  meta: z.array(z.string()).readonly(),
})

export type SubscriptionPresentation = z.infer<typeof subscriptionPresentationSchema>

export type SubscriptionPresentationInput = {
  provider: string
  label: string
  target: unknown
  status: ESubscriptionStatus
  events: readonly string[]
}

export type SubscriptionPresenter = (
  input: SubscriptionPresentationInput,
) => SubscriptionPresentation

export type SubscriptionPresenters = Readonly<Record<string, SubscriptionPresenter>>

export const NEUTRAL_SUBSCRIPTION_ICON = 'bell'

export const neutralPresentationOf = (
  input: SubscriptionPresentationInput,
): SubscriptionPresentation => ({
  icon: NEUTRAL_SUBSCRIPTION_ICON,
  tone: ESubscriptionTone.Neutral,
  title: input.label,
  meta: [],
})

export const presentSubscription = (args: {
  input: SubscriptionPresentationInput
  presenters: SubscriptionPresenters
}): SubscriptionPresentation =>
  (args.presenters[args.input.provider] ?? neutralPresentationOf)(args.input)
