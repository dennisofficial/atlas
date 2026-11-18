import {
  ESkipReason,
  promptContextKey,
  type CompiledPrompt,
  type PromptContext,
  type PromptFragment,
  type PromptPart,
  type SkippedFragment,
} from '@dltech/atlas-core'

import { isVolatilePromptFragment } from './prompt-fragments/volatile'

const compileFragments = (args: {
  fragments: readonly PromptFragment[]
  ctx: PromptContext
}): CompiledPrompt => {
  const parts: PromptPart[] = []
  const skipped: SkippedFragment[] = []

  for (const fragment of args.fragments) {
    if (!fragment.applies(args.ctx)) {
      skipped.push({ id: fragment.id, reason: ESkipReason.Condition })
      continue
    }

    const text = fragment.text(args.ctx).trim()
    if (text.length === 0) {
      skipped.push({ id: fragment.id, reason: ESkipReason.Empty })
      continue
    }

    parts.push({ id: fragment.id, text, chars: text.length })
  }

  if (parts.length === 0) return { blocks: [], parts, skipped }

  return { blocks: [{ text: parts.map((part) => part.text).join('\n\n') }], parts, skipped }
}

export class PromptFragmentRegistry {
  private readonly memo = new Map<string, { stamp: string; compiled: CompiledPrompt }>()
  private readonly volatile: readonly PromptFragment[]

  constructor(private readonly fragments: readonly PromptFragment[]) {
    const ids = new Set<string>()
    for (const fragment of fragments) {
      if (ids.has(fragment.id)) {
        throw new Error(`two prompt fragments are registered as "${fragment.id}"`)
      }
      ids.add(fragment.id)
    }
    this.volatile = fragments.filter(isVolatilePromptFragment)
  }

  compile(ctx: PromptContext): CompiledPrompt {
    const key = promptContextKey(ctx)
    const stamp = JSON.stringify(
      this.volatile.map((fragment) =>
        isVolatilePromptFragment(fragment) ? fragment.stamp(ctx) : '',
      ),
    )
    const remembered = this.memo.get(key)
    if (remembered !== undefined && remembered.stamp === stamp) return remembered.compiled

    const compiled = compileFragments({ fragments: this.fragments, ctx })
    this.memo.set(key, { stamp, compiled })
    return compiled
  }
}
