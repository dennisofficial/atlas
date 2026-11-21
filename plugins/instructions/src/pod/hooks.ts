import type { RegisteredHook } from '@dltech/atlas-agent'
import { EStage, type BeforeStep } from '@dltech/atlas-core'
import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'
import { readResource } from '@dltech/atlas-plugin-sdk'

import { blockOf, instructionPathOf, PERSONAL_HEADER, projectHeader } from './blocks'
import {
  instructionsResource,
  type InstructionsPodOptions,
  type InstructionsSnapshot,
} from './resources'
import { descentOf, nestedDirectoriesOf, touchedSincePromptOf } from './sources'

type Ctx = Pick<PluginPodContext, 'events' | 'log'>

const ORDER = { stage: EStage.Observe, nudge: 0 } as const

export const instructionsBlocks = (args: {
  ctx: Ctx
  options: InstructionsPodOptions
}): RegisteredHook<BeforeStep> => ({
  name: 'instructions-blocks',
  order: ORDER,
  run: async ({ assembled }) => {
    const snapshot = readResource({ ctx: args.ctx, resource: instructionsResource(args.options) })
    if (snapshot === undefined) return assembled
    const blocks = blocksOf({ snapshot, touched: touchedSincePromptOf(args.ctx.events()) })
    if (blocks.length === 0) return assembled
    return {
      ...assembled,
      system: [...assembled.system, ...blocks.map((text) => ({ text, source: 'instructions' }))],
    }
  },
})

const blocksOf = (args: {
  snapshot: InstructionsSnapshot
  touched: readonly string[]
}): readonly string[] => {
  const { snapshot } = args
  const blocks: string[] = []

  const personal = blockOf({ header: PERSONAL_HEADER, content: snapshot.personal ?? '' })
  if (personal !== null) blocks.push(personal)

  const descent = descentOf({ root: snapshot.root, directory: snapshot.directory })
  const nested = nestedDirectoriesOf({
    root: snapshot.root,
    covered: descent,
    touched: args.touched,
  })
  for (const directory of [...descent, ...nested]) {
    const path = instructionPathOf(directory)
    const content = snapshot.files[path]
    if (content === undefined) continue
    const block = blockOf({ header: projectHeader(path), content })
    if (block !== null) blocks.push(block)
  }
  return blocks
}
