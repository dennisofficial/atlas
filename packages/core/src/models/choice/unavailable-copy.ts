export const connectProviderOffer = (providerLabel: string): string =>
  `Connect ${providerLabel} in Settings → Providers, or pick another model in Settings → Models & Effort`

export const connectProviderAdvice = (providerLabel: string): string =>
  `${connectProviderOffer(providerLabel)}, then retry.`

export const unavailableModelMessage = (args: {
  subject: string
  modelLabel: string
  providerLabel: string
}): string =>
  `${args.subject} is set to ${args.modelLabel}, but ${args.providerLabel} isn't connected.`
