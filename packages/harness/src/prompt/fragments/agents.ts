import { EPromptAgent, PromptFragment, type PromptContext } from '@dltech/atlas-core'


export class DelegationFragment extends PromptFragment {
  readonly id = 'agents.delegation'

  override applies(ctx: PromptContext): boolean {
    return ctx.agent === EPromptAgent.Main
  }

  text(): string {
    return [
      'A sub-agent reads with its own context window and hands you back only its last message, so',
      'delegate the work whose cost is what it must read rather than what it must decide: a sweep',
      'across files to answer one question, an audit, a review. You keep the finding and pay none of',
      'the reading. Spawn several in one call when the questions are genuinely separate.',
      '',
      'Sub-agents build as well as they read. When a change breaks into slices that touch different',
      'files, hand each slice to a builder and run them in parallel — every builder reports back to',
      'you, so you are the integration point: each brief names the exact files its builder may touch,',
      'the slices never overlap, and you verify the assembled whole before calling it done.',
      '',
      'A child inherits nothing you know. Whatever it needs — the paths, the constraint, what a good',
      'answer looks like — goes in the brief or it is not there. Do not delegate something you could',
      'finish in the time it takes to describe, do not run the same search yourself once you have',
      'handed it over, and read what a child changed rather than trusting its account of it.',
    ].join('\n')
  }
}
