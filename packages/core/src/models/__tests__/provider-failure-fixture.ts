import { classifyProviderFailure, type ProviderFailureEvidence } from '../provider-failure'

export const classify = (evidence: Partial<ProviderFailureEvidence>) =>
  classifyProviderFailure({ evidence: { message: 'boom', ...evidence } })

export const MONTHLY_SPEND_TEXT =
  "This request would exceed your account's monthly spend limit. Please try again later."

export const anthropicMonthly = (overrides: Partial<ProviderFailureEvidence> = {}) =>
  classify({
    providerId: 'anthropic',
    statusCode: 429,
    providerType: 'rate_limit_error',
    providerMessage: MONTHLY_SPEND_TEXT,
    authorizationDelivered: true,
    ...overrides,
  })
