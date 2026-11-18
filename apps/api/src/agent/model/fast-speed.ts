import type { SharedV4ProviderMetadata } from '@ai-sdk/provider'

export const reportsFastSpeed = (metadata: SharedV4ProviderMetadata | undefined): boolean =>
  Object.values(metadata ?? {}).some((bucket) => {
    const usage = bucket?.usage
    return typeof usage === 'object' && usage !== null && 'speed' in usage && usage.speed === 'fast'
  })
