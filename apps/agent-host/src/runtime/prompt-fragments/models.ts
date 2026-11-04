import { PromptFragment, type PromptContext } from '@dltech/atlas-core'

const KIMI_MODEL = 'kimi'

export class AnswerInTextFragment extends PromptFragment {
  readonly id = 'models.answer-in-text'

  override applies(ctx: PromptContext): boolean {
    return ctx.provider.modelId.toLowerCase().includes(KIMI_MODEL)
  }

  text(): string {
    return [
      'Finish every turn in the text channel, never in reasoning alone: the developer sees only your',
      'text, and a reply that lives entirely in reasoning renders as nothing and ends the turn. When the',
      'work is done, write the full answer as message text.',
    ].join('\n')
  }
}
