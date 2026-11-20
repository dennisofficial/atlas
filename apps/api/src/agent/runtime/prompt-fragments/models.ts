import { PromptFragment, type PromptContext } from '@dltech/atlas-core'

const KIMI_MODEL = 'kimi'

export class AnswerInTextFragment extends PromptFragment {
  readonly id = 'models.answer-in-text'

  override applies(ctx: PromptContext): boolean {
    return ctx.provider.modelId.toLowerCase().includes(KIMI_MODEL)
  }

  text(): string {
    return [
      'Write the answer as message text at the end of every turn. Never put the answer in reasoning',
      'alone. The operator reads only message text. A reply that is only in reasoning shows nothing and',
      'ends the turn. When the work is done, write the full answer as message text.',
    ].join('\n')
  }
}
