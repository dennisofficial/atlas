import { EMPTY_POD, type PodSlot } from '@dltech/atlas-plugin-sdk'

import {
  instructionsBlocks,
  instructionsTouch,
  instructionsTurn,
  type InstructionsPodOptions,
} from './hooks'
import { stateFor } from './state'

export type { InstructionsPodOptions } from './hooks'
export { PERSONAL_HEADER, projectHeader } from './blocks'

export const instructionsPodOf = (options: InstructionsPodOptions): PodSlot => ({
  ...EMPTY_POD,
  hooks: (ctx) => {
    const state = stateFor(ctx)
    return {
      beforeTurn: [instructionsTurn({ state })],
      beforeStep: [instructionsBlocks({ ctx, state, options })],
      afterTool: [instructionsTouch({ state })],
    }
  },
})
