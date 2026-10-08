import { EPromptAgent, PromptFragment, type PromptContext } from '@dltech/atlas-core'

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

export class OperatorInputFragment extends PromptFragment {
  readonly id = 'tools.operator-input'

  override applies(ctx: PromptContext): boolean {
    return ctx.agent === EPromptAgent.Main
  }

  text(): string {
    return [
      'When a process needs a value only the operator can supply — a device code, an OTP, a login token, any long paste —',
      'ask for it with operator_input. Ask once, then reuse the delivered value: keep the file it landed in and read or pipe',
      'from it as often as the work needs instead of asking again.',
    ].join(' ')
  }
}
