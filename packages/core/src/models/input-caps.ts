import { CONTEXT_WINDOW_UNMEASURED, type ModelTraits } from '../ports/model.port'
import { refKey, type ModelRef } from './ref'

// inference.net serves kimi-k3 from a heterogeneous SGLang fleet: small replicas reject any
// request whose input (expanded with image patches) reaches 249,994 tokens, while large ones
// honour the advertised 1,048,576. 245,000 leaves headroom under that wall for estimator error.
// https://github.com/sgl-project/sglang/blob/main/python/sglang/srt/managers/scheduler.py
const DEPLOYED_INPUT_CAPS: ReadonlyMap<string, number> = new Map([
  ['inference/kimi-k3', 245_000],
  ['inference/kimi-k3-fast', 245_000],
])

export const deployedInputCapFor = (ref: ModelRef): number | undefined =>
  DEPLOYED_INPUT_CAPS.get(refKey(ref))

/** A card whose window was never measured stays unmeasured; the cap only shrinks a real one. */
export function cappedTraits(args: {
  card: { ref: ModelRef }
  traits: ModelTraits
}): ModelTraits {
  const window = args.traits.contextWindow
  if (window === undefined || window === CONTEXT_WINDOW_UNMEASURED) return args.traits

  const cap = deployedInputCapFor(args.card.ref)
  if (cap === undefined || cap >= window) return args.traits

  return { ...args.traits, contextWindow: cap }
}
