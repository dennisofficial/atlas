import { EPromptAgent, PromptFragment, type PromptContext } from '@dltech/atlas-core'


export class AtlasIdentityFragment extends PromptFragment {
  readonly id = 'identity.atlas'

  override applies(ctx: PromptContext): boolean {
    return ctx.agent === EPromptAgent.Main
  }

  text(): string {
    return 'You are Atlas, a coding agent.'
  }
}
