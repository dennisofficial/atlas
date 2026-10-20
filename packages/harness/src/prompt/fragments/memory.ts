import { EPromptAgent, memoryPromptText, type PromptContext } from '@dltech/atlas-core'

import type { MemoryIndexState } from '../../memory/memory-index-state'
import { VolatilePromptFragment } from '../volatile'

const NOT_LOADED = 'Not loaded yet.'

export class MemoryFragment extends VolatilePromptFragment {
  readonly id = 'memory.instructions'

  private readonly instructions = memoryPromptText()

  constructor(private readonly args: { state: MemoryIndexState }) {
    super()
  }

  override applies(ctx: PromptContext): boolean {
    return ctx.agent === EPromptAgent.Main
  }

  stamp(): string {
    return this.args.state.text ?? ''
  }

  text(): string {
    return `${this.instructions}\n\n## What you remember\n\n${this.args.state.text ?? NOT_LOADED}`
  }
}
