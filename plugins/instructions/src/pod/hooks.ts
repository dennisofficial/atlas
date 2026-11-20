import { join } from 'node:path'

import type { RegisteredHook } from '@dltech/atlas-agent'
import {
  EContextSlot,
  EStage,
  type AfterTool,
  type BeforeStep,
  type BeforeTurn,
  type EventDraft,
  type ThreadId,
} from '@dltech/atlas-core'
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

type Ctx = Pick<PluginPodContext, 'call' | 'log' | 'events'>

const ORDER = { stage: EStage.Observe, nudge: 0 } as const

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

export const instructionsTurn = (args: {
  state: InstructionsPodState
}): RegisteredHook<BeforeTurn> => ({
  name: 'instructions-turn',
  order: ORDER,
  awaited: true,
  run: async ({ threadId, projectDirectory }) => {
    args.state.threadId = threadId
    args.state.directory = projectDirectory
    args.state.turn = { root: null, personal: null, files: new Map() }
    return {}
  },
})

export const instructionsTouch = (args: {
  ctx: Ctx
  state: InstructionsPodState
}): RegisteredHook<AfterTool> => ({
  name: 'instructions-touch',
  order: ORDER,
  run: async ({ call, result, projectDirectory }) => {
    if (!result.ok) return {}
    const touched = touchedDirectoriesOf(call.input)
    if (touched.length === 0) return {}
    const drafts = await nestedDraftsOf({
      ctx: args.ctx,
      state: args.state,
      threadId: call.threadId,
      directory: args.state.directory ?? projectDirectory,
      touched,
    })
    return drafts.length === 0 ? {} : { drafts }
  },
})

const turnOf = (state: InstructionsPodState): InstructionTurn => {
  const turn = state.turn ?? { root: null, personal: null, files: new Map() }
  state.turn = turn
  return turn
}

const loadedNestedOf = (args: {
  ctx: Ctx
  state: InstructionsPodState
  threadId: ThreadId
}): Map<string, string> => {
  const offered = args.state.offered.get(args.threadId) ?? new Map<string, string>()
  args.state.offered.set(args.threadId, offered)
  for (const event of args.ctx.events()) {
    if (event.threadId !== args.threadId || event.type !== 'context-loaded') continue
    if (event.slot !== EContextSlot.NestedInstructions) continue
    offered.set(event.key, event.content)
  }
  return offered
}

const nestedDraftsOf = async (args: {
  ctx: Ctx
  state: InstructionsPodState
  threadId: ThreadId
  directory: string
  touched: readonly string[]
}): Promise<readonly EventDraft[]> => {
  const turn = turnOf(args.state)
  turn.root ??= repoRootOf({ ctx: args.ctx, directory: args.directory })
  const root = await turn.root
  const nested = nestedDirectoriesOf({
    root,
    covered: descentOf({ root, directory: args.directory }),
    touched: args.touched,
  })
  if (nested.length === 0) return []
  const offered = loadedNestedOf(args)
  const drafts: EventDraft[] = []
  for (const candidate of nested) {
    const content = (
      (await instructionFileOf({ ctx: args.ctx, directory: candidate, cache: turn.files })) ?? ''
    ).trim()
    const key = join(candidate, INSTRUCTION_FILE)
    if (content === '' || offered.get(key) === content) continue
    offered.set(key, content)
    drafts.push({ type: 'context-loaded', slot: EContextSlot.NestedInstructions, key, content })
  }
  return drafts
}

export const instructionsBlocks = (args: {
  ctx: Ctx
  state: InstructionsPodState
  options: InstructionsPodOptions
}): RegisteredHook<BeforeStep> => ({
  name: 'instructions-blocks',
  order: ORDER,
  awaited: true,
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
  if (directory === null || args.state.threadId === null) return []
  const turn = turnOf(args.state)
  turn.root ??= repoRootOf({ ctx: args.ctx, directory })
  const root = await turn.root

  const blocks: string[] = []
  const personal = blockOf({
    header: PERSONAL_HEADER,
    content: (await personalOf({ ctx: args.ctx, options: args.options, turn })) ?? '',
  })
  if (personal !== null) blocks.push(personal)

  for (const candidate of descentOf({ root, directory })) {
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
