import type { EPromptGroup } from './group'
import type { PromptContext } from './context'
import type { PromptFragment } from './fragment'
import { PROMPT_MODEL_SAMPLES, type PromptModel } from './model'

export type ModelTraitProbe = { key: string; model: PromptModel }

export function reachablePromptContexts(args: {
  groupSets: readonly (readonly EPromptGroup[])[]
  providerIds: readonly string[]
  projectDirectory: string
}): readonly PromptContext[] {
  const { projectDirectory } = args

  return args.groupSets.flatMap((groups) =>
    args.providerIds.flatMap((id) =>
      PROMPT_MODEL_SAMPLES.map((model) => ({
        groups,
        provider: { id, modelId: `sampled-${model.contextWindow}` },
        model,
        projectDirectory,
      })),
    ),
  )
}

export function deadFragmentIds(args: {
  fragments: readonly PromptFragment[]
  contexts: readonly PromptContext[]
}): readonly string[] {
  return args.fragments
    .filter((fragment) => !args.contexts.some((ctx) => fragment.applies(ctx)))
    .map((fragment) => fragment.id)
}

const renderOf = (args: { fragments: readonly PromptFragment[]; ctx: PromptContext }): string =>
  args.fragments
    .filter((fragment) => fragment.applies(args.ctx))
    .map((fragment) => `${fragment.id}\n${fragment.text(args.ctx)}`)
    .join('\n\n')

export function unreadModelTraits(args: {
  fragments: readonly PromptFragment[]
  base: PromptContext
  probes: readonly ModelTraitProbe[]
}): readonly string[] {
  const baseline = renderOf({ fragments: args.fragments, ctx: args.base })

  return args.probes
    .filter(
      (probe) =>
        renderOf({
          fragments: args.fragments,
          ctx: { ...args.base, model: probe.model },
        }) === baseline,
    )
    .map((probe) => probe.key)
}
