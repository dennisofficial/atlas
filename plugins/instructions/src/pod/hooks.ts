import type { RegisteredHook } from '@dltech/atlas-agent'
import {
  EContextSlot,
  EStage,
  type AfterTool,
  type BeforeStep,
  type EventDraft,
  type V2Event,
} from '@dltech/atlas-core'
import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'
import { readResource } from '@dltech/atlas-plugin-sdk'

import { blockOf, instructionPathOf, PERSONAL_HEADER, projectHeader } from './blocks'
import {
  instructionsResource,
  type InstructionsPodOptions,
  type InstructionsSnapshot,
} from './resources'
import { descentOf, nestedDirectoriesOf, touchedDirectoriesOf } from './sources'

type Ctx = Pick<PluginPodContext, 'events' | 'log'>

const ORDER = { stage: EStage.Observe, nudge: 0 } as const

const NESTED_SLOT = EContextSlot.NestedInstructions

export const instructionsBlocks = (args: {
  ctx: Ctx
  options: InstructionsPodOptions
}): RegisteredHook<BeforeStep> => ({
  name: 'instructions-blocks',
  order: ORDER,
  awaited: true,
  run: async ({ assembled }) => {
    const snapshot = snapshotOf(args)
    if (snapshot === undefined) return assembled
    const blocks = descentBlocksOf({ snapshot })
    if (blocks.length === 0) return assembled
    return {
      ...assembled,
      system: [...assembled.system, ...blocks.map((text) => ({ text, source: 'instructions' }))],
    }
  },
})

export const instructionsTouch = (args: {
  ctx: Ctx
  options: InstructionsPodOptions
}): RegisteredHook<AfterTool> => ({
  name: 'instructions-touch',
  order: ORDER,
  run: async ({ call, result }) => {
    if (!result.ok) return {}
    const touched = touchedDirectoriesOf(call.input)
    if (touched.length === 0) return {}
    const snapshot = snapshotOf(args)
    if (snapshot === undefined) return {}
    const drafts = nestedDraftsOf({
      snapshot,
      touched,
      recorded: recordedNestedOf(args.ctx.events()),
    })
    return drafts.length === 0 ? {} : { drafts }
  },
})

const snapshotOf = (args: {
  ctx: Ctx
  options: InstructionsPodOptions
}): InstructionsSnapshot | undefined =>
  readResource({ ctx: args.ctx, resource: instructionsResource(args.options) })

const recordedNestedOf = (events: readonly V2Event[]): ReadonlyMap<string, string> => {
  const recorded = new Map<string, string>()
  for (const event of events) {
    if (event.type !== 'context-loaded' || event.slot !== NESTED_SLOT) continue
    recorded.set(event.key, event.content)
  }
  return recorded
}

const nestedDraftsOf = (args: {
  snapshot: InstructionsSnapshot
  touched: readonly string[]
  recorded: ReadonlyMap<string, string>
}): readonly EventDraft[] => {
  const { snapshot } = args
  const directories = nestedDirectoriesOf({
    root: snapshot.root,
    covered: descentOf({ root: snapshot.root, directory: snapshot.directory }),
    touched: args.touched,
  })

  const drafts: EventDraft[] = []
  for (const directory of directories) {
    const key = instructionPathOf(directory)
    const content = (snapshot.files[key] ?? '').trim()
    if (content === '' || args.recorded.get(key) === content) continue
    drafts.push({ type: 'context-loaded', slot: NESTED_SLOT, key, content })
  }
  return drafts
}

const descentBlocksOf = (args: { snapshot: InstructionsSnapshot }): readonly string[] => {
  const { snapshot } = args
  const blocks: string[] = []

  const personal = blockOf({ header: PERSONAL_HEADER, content: snapshot.personal ?? '' })
  if (personal !== null) blocks.push(personal)

  for (const directory of descentOf({ root: snapshot.root, directory: snapshot.directory })) {
    const path = instructionPathOf(directory)
    const content = snapshot.files[path]
    if (content === undefined) continue
    const block = blockOf({ header: projectHeader(path), content })
    if (block !== null) blocks.push(block)
  }
  return blocks
}
