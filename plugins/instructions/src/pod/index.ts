import { EMPTY_POD, type PodSlot } from '@dltech/atlas-plugin-sdk'

import { instructionsBlocks } from './hooks'
import { instructionsResource, type InstructionsPodOptions } from './resources'

export type { InstructionsPodOptions } from './resources'
export { PERSONAL_HEADER, projectHeader } from './blocks'
export { INSTRUCTIONS_RESOURCE, instructionsResource } from './resources'

export const instructionsPodOf = (options: InstructionsPodOptions): PodSlot => ({
  ...EMPTY_POD,
  resources: [instructionsResource(options)],
  hooks: (ctx) => ({ beforeStep: [instructionsBlocks({ ctx, options })] }),
})
