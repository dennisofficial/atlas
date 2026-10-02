import { EPromptAgent, PromptFragment, type PromptContext } from '@dltech/atlas-core'


export class DelegationFragment extends PromptFragment {
  readonly id = 'agents.delegation'

  override applies(ctx: PromptContext): boolean {
    return ctx.agent === EPromptAgent.Main
  }

  text(): string {
    return [
      'Delegate by default: exploratory work, independent slices, and whole workstreams go to other',
      'agents without asking first.',
      '',
      'Bounded tasks go to sub-agents: a search across files, an audit, a review, a slice of a change',
      'touching named files. Spawn several in one call when the questions are genuinely separate, keep',
      'builder slices disjoint, and verify the assembled whole yourself.',
      '',
      'A whole workstream — a full feature, a long-running effort — goes to a teammate: a peer session',
      'with its own worktree, sub-agents, and execution location that reports to you when something',
      'changes. Work that should run beside you belongs to a teammate; work that should run under you',
      'belongs to a sub-agent.',
      '',
      'Whatever an agent needs — paths, constraints, what a good answer looks like — goes in its brief.',
      'Do not delegate work you could finish faster than describing it, and do not repeat a search you',
      'have handed over.',
    ].join('\n')
  }
}
