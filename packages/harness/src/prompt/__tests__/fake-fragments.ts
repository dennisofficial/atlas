import { ALL_PROMPT_GROUPS, PromptFragment, type PromptContext } from '@dltech/atlas-core'

export const contextFor = (args: {
  modelId: string
  providerId?: string
  projectDirectory?: string
}): PromptContext => ({
  groups: ALL_PROMPT_GROUPS,
  provider: { id: args.providerId ?? 'anthropic-oauth', modelId: args.modelId },
  projectDirectory: args.projectDirectory ?? '/w',
})

export class SayingFragment extends PromptFragment {
  constructor(
    readonly id: string,
    private readonly saying: string,
  ) {
    super()
  }

  text(): string {
    return this.saying
  }
}

export class ConditionalFragment extends PromptFragment {
  constructor(
    readonly id: string,
    private readonly saying: string,
    private readonly condition: (ctx: PromptContext) => boolean,
  ) {
    super()
  }

  override applies(ctx: PromptContext): boolean {
    return this.condition(ctx)
  }

  text(): string {
    return this.saying
  }
}

export class CountingFragment extends PromptFragment {
  calls = 0

  constructor(readonly id: string) {
    super()
  }

  text(ctx: PromptContext): string {
    this.calls += 1
    return `compiled for ${ctx.provider.modelId}`
  }
}
