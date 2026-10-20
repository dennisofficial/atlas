import { pastedTagSpans } from '@dltech/atlas-core'

import type { LiveToken } from '../ui/composer-tokens'
import type { DraftImage } from '../ui/draft-images'
import type { DraftTokens } from '../ui/hooks/use-draft-tokens'

export function draftPutBack(args: {
  tokens: DraftTokens
  said: string
  typedSince: string
  live: readonly LiveToken[]
  images: readonly DraftImage[]
}): void {
  const pastes = args.live.flatMap((token) => {
    if (token.slot.kind !== 'pasted') return []
    const span = pastedTagSpans(token.slot.label)[0]
    return span === undefined ? [] : [{ ordinal: span.ordinal, content: token.slot.content }]
  })
  args.tokens.restore({
    text: args.typedSince.trim().length === 0 ? args.said : `${args.said}\n\n${args.typedSince}`,
    images: args.images,
    pastes,
  })
}
