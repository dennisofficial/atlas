import { EPromptGroup, PromptFragment, type PromptContext } from '@dltech/atlas-core'

export class AtlasIdentityFragment extends PromptFragment {
  readonly id = 'identity.atlas'

  override applies(ctx: PromptContext): boolean {
    return ctx.groups.includes(EPromptGroup.Identity)
  }

  text(): string {
    return 'You are Atlas, a coding agent.'
  }
}
