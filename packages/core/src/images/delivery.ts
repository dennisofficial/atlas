import { MAX_API_EDGE, MAX_INLINE_BYTES, type ImageFacts } from './limits'

export enum EImageDelivery {
  Inline = 'inline',
  Url = 'url',
  PathOnly = 'path-only',
}

export type ImageSupport = 'inline' | 'url' | 'both' | 'none'

export type ImageCapabilities = {
  images: ImageSupport
  maxInlineBytes: number
  maxEdge?: number | undefined
}

export type DeliverySources = { inline: boolean; url: boolean }

export type DeliveryPlan = { delivery: EImageDelivery; reason?: string }

export const NEUTRAL_IMAGE_CAPABILITIES: ImageCapabilities = {
  images: 'inline',
  maxInlineBytes: MAX_INLINE_BYTES,
  maxEdge: MAX_API_EDGE,
}

const megabytes = (bytes: number): string => `${(bytes / 1024 / 1024).toFixed(1)} MB`

const accepts = ({ support, kind }: { support: ImageSupport; kind: 'inline' | 'url' }): boolean =>
  support === 'both' || support === kind

const pathOnly = (reason: string): DeliveryPlan => ({ delivery: EImageDelivery.PathOnly, reason })

function inlineVerdict({
  facts,
  capabilities,
}: {
  facts: ImageFacts
  capabilities: ImageCapabilities
}): DeliveryPlan {
  if (facts.byteLength <= capabilities.maxInlineBytes) return { delivery: EImageDelivery.Inline }

  return pathOnly(
    `${megabytes(facts.byteLength)} is past the ${megabytes(capabilities.maxInlineBytes)} inline limit`,
  )
}

/**
 * Resizing locally saves no tokens: the API bills patches of the size it resizes to, not of the
 * bytes on the wire. So the long edge is never a reason to withhold or shrink a picture, and only
 * the ceilings the model actually enforces are. A link is preferred where the model takes one,
 * because it keeps the bytes out of every later request that replays the history.
 */
export function planDelivery({
  facts,
  capabilities,
  sources,
}: {
  facts: ImageFacts
  capabilities: ImageCapabilities
  sources: DeliverySources
}): DeliveryPlan {
  const { images, maxEdge } = capabilities
  if (images === 'none') return pathOnly('the model cannot see images')

  const longEdge = Math.max(facts.width ?? 0, facts.height ?? 0)
  if (maxEdge !== undefined && longEdge > maxEdge) {
    return pathOnly(`its ${longEdge} pixel long edge is past the ${maxEdge} the API accepts`)
  }

  const byUrl = accepts({ support: images, kind: 'url' })
  const byBytes = accepts({ support: images, kind: 'inline' })

  if (byUrl && sources.url) return { delivery: EImageDelivery.Url }
  if (byBytes && sources.inline) return inlineVerdict({ facts, capabilities })
  if (byBytes) return pathOnly('no copy of its bytes is held to send inline')
  return pathOnly('the model takes pictures by link and none could be made for it')
}

export const planInlineDelivery = (facts: ImageFacts): DeliveryPlan =>
  planDelivery({
    facts,
    capabilities: NEUTRAL_IMAGE_CAPABILITIES,
    sources: { inline: true, url: false },
  })
