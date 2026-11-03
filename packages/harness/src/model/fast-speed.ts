import type { SharedV4ProviderMetadata } from '@ai-sdk/provider'

// Anthropic echoes the speed a request actually ran at as `usage.speed` ("fast" | "standard"); a
// fast request on a model that quietly runs standard (Opus 4.6) reports "standard".
// https://platform.claude.com/docs/en/build-with-claude/fast-mode#checking-which-speed-was-used
export const reportsFastSpeed = (metadata: SharedV4ProviderMetadata | undefined): boolean =>
  Object.values(metadata ?? {}).some((bucket) => {
    const usage = bucket?.usage
    return typeof usage === 'object' && usage !== null && 'speed' in usage && usage.speed === 'fast'
  })
