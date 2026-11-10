import type { EPromptGroup } from './group'
import type { PromptContext } from './context'
import type { PromptFragment } from './fragment'

export function reachablePromptContexts(args: {
  groupSets: readonly (readonly EPromptGroup[])[]
  providerIds: readonly string[]
  projectDirectory: string
}): readonly PromptContext[] {
  const { projectDirectory } = args

  return args.groupSets.flatMap((groups) =>
    args.providerIds.map((id) => ({
      groups,
      provider: { id, modelId: `sampled-${id}` },
      projectDirectory,
    })),
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
