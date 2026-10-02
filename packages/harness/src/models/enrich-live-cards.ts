import { CONTEXT_WINDOW_UNMEASURED, refKey, type ModelCard } from '@dltech/atlas-core'

const enrichCard = (args: { live: ModelCard; generated: ModelCard }): ModelCard => {
  const { live, generated } = args
  const cost = live.cost ?? generated.cost
  const maxOutputTokens = live.maxOutputTokens ?? generated.maxOutputTokens
  return {
    ...live,
    contextWindow:
      live.contextWindow > CONTEXT_WINDOW_UNMEASURED ? live.contextWindow : generated.contextWindow,
    ...(cost === undefined ? {} : { cost: { ...cost } }),
    ...(maxOutputTokens === undefined ? {} : { maxOutputTokens }),
  }
}

export function enrichLiveCards(args: {
  live: readonly ModelCard[]
  generated: readonly ModelCard[]
}): ModelCard[] {
  const generatedByRef = new Map(args.generated.map((card) => [refKey(card.ref), card]))
  return args.live.map((live) => {
    const generated = generatedByRef.get(refKey(live.ref))
    return generated === undefined ? live : enrichCard({ live, generated })
  })
}
