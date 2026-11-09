import { memoryPromptText, PromptFragment } from '@dltech/atlas-core'

export class MemoryFragment extends PromptFragment {
  readonly id = 'memory.instructions'

  text(): string {
    return memoryPromptText()
  }
}
