import { join } from 'node:path'

import type { RegisteredHook } from '@dltech/atlas-agent'
import { EStage, type AfterTool, type BeforeStep, type BeforeTurn } from '@dltech/atlas-core'
import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'

import { blockOf, instructionFileOf, PERSONAL_HEADER, projectHeader } from './blocks'
import {
  descentOf,
  INSTRUCTION_FILE,
  nestedDirectoriesOf,
  repoRootOf,
  touchedDirectoriesOf,
} from './sources'
import type { InstructionTurn, InstructionsPodState } from './state'

export type InstructionsPodOptions = {
  personal: () => Promise<string | null>
}

type Ctx = Pick<PluginPodContext, 'call' | 'log'>

const ORDER = { stage: EStage.Observe, nudge: 0 } as const

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

export const instructionsTurn = (args: {
  state: InstructionsPodState
}): RegisteredHook<BeforeTurn> => ({
  name: 'instructions-turn',
  order: ORDER,
  run: async ({ threadId, projectDirectory }) => {
    args.state.threadId = threadId
    args.state.directory = projectDirectory
    args.state.turn = { root: null, personal: null, files: new Map() }
    return {}
  },
})

export const instructionsTouch = (args: {
  state: InstructionsPodState
}): RegisteredHook<AfterTool> => ({
  name: 'instructions-touch',
  order: ORDER,
  run: async ({ call, result }) => {
    if (!result.ok) return {}
    const touched = args.state.touched.get(call.threadId) ?? new Set<string>()
    for (const directory of touchedDirectoriesOf(call.input)) touched.add(directory)
    args.state.touched.set(call.threadId, touched)
    return {}
  },
})

export const instructionsBlocks = (args: {
  ctx: Ctx
  state: InstructionsPodState
  options: InstructionsPodOptions
}): RegisteredHook<BeforeStep> => ({
  name: 'instructions-blocks',
  order: ORDER,
  run: async ({ assembled }) => {
    const blocks = await blocksOf(args)
    if (blocks.length === 0) return assembled
    return {
      ...assembled,
      system: [...assembled.system, ...blocks.map((text) => ({ text, source: 'instructions' }))],
    }
  },
})

const blocksOf = async (args: {
  ctx: Ctx
  state: InstructionsPodState
  options: InstructionsPodOptions
}): Promise<readonly string[]> => {
  const directory = args.state.directory
  const threadId = args.state.threadId
  if (directory === null || threadId === null) return []
  const turn = args.state.turn ?? { root: null, personal: null, files: new Map() }
  args.state.turn = turn
  turn.root ??= repoRootOf({ ctx: args.ctx, directory })
  const root = await turn.root

  const blocks: string[] = []
  const personal = blockOf({
    header: PERSONAL_HEADER,
    content: (await personalOf({ ctx: args.ctx, options: args.options, turn })) ?? '',
  })
  if (personal !== null) blocks.push(personal)

  const descent = descentOf({ root, directory })
  const nested = nestedDirectoriesOf({
    root,
    covered: descent,
    touched: [...(args.state.touched.get(threadId) ?? [])],
  })
  for (const candidate of [...descent, ...nested]) {
    const content = await instructionFileOf({
      ctx: args.ctx,
      directory: candidate,
      cache: turn.files,
    })
    if (content === null) continue
    const block = blockOf({
      header: projectHeader(join(candidate, INSTRUCTION_FILE)),
      content,
    })
    if (block !== null) blocks.push(block)
  }
  return blocks
}

const personalOf = async (args: {
  ctx: Ctx
  options: InstructionsPodOptions
  turn: InstructionTurn
}): Promise<string | null> => {
  args.turn.personal ??= args.options.personal().catch((error: unknown) => {
    args.ctx.log(`personal instructions unavailable: ${messageOf(error)}`)
    return null
  })
  return await args.turn.personal
}
