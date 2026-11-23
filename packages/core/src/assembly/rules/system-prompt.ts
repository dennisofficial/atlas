import type { CompiledPrompt } from '../../prompt/compiled'
import { projectDirectoryOf } from '../../workspace/worktree'
import type { SystemBlock } from '../assembled'
import { defineRule, type Rule } from '../rule'

export const EMPTY_PROMPT: CompiledPrompt = { blocks: [], parts: [], skipped: [] }

export type PromptSource = (args: { projectDirectory: string }) => CompiledPrompt

const measured = (args: {
  blocks: readonly SystemBlock[]
  prompt: CompiledPrompt
}): readonly SystemBlock[] => {
  const [only] = args.blocks
  if (only === undefined || args.blocks.length > 1 || args.prompt.parts.length === 0) {
    return args.blocks
  }
  return [
    {
      ...only,
      parts: args.prompt.parts.map((part) => ({ id: part.id, chars: part.chars })),
    },
  ]
}

export function systemPrompt({
  prompt,
  launchDirectory,
}: {
  prompt: PromptSource
  launchDirectory: string
}): Rule {
  return defineRule({
    name: 'systemPrompt',
    apply: (input, ctx) => {
      const compiled = prompt({
        projectDirectory: projectDirectoryOf({ events: ctx.events, launchDirectory }),
      })
      const blocks = compiled.blocks.map((block) => ({ ...block, source: 'system-prompt' }))
      return {
        system: [...input.system, ...measured({ blocks, prompt: compiled })],
        messages: input.messages,
      }
    },
  })
}
