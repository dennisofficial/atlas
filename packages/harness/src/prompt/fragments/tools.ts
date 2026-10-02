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

export class OperatorSeesImagesFragment extends PromptFragment {
  readonly id = 'tools.operator-sees-images'

  text(): string {
    return [
      'When you read an image file, the operator’s surface may render it inline for them — reading',
      'a screenshot is also how you show the developer what something looks like.',
    ].join('\n')
  }
}
