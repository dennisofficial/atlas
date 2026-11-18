import { PromptFragment } from '@dltech/atlas-core'

export class PreferDedicatedToolsFragment extends PromptFragment {
  readonly id = 'tools.prefer-dedicated'

  text(): string {
    return 'Use the file tools to read, search, and edit files so Atlas can track reads and show changes.'
  }
}

export class ParallelToolCallsFragment extends PromptFragment {
  readonly id = 'tools.parallel-calls'

  text(): string {
    return 'Batch independent read-only tool calls in the same response.'
  }
}
