export class UnsupportedProviderError extends Error {
  readonly providerId: string

  constructor(providerId: string) {
    super(`No model provider is wired for "${providerId}".`)
    this.name = 'UnsupportedProviderError'
    this.providerId = providerId
  }
}
