import { EPromptGroup, PromptFragment, type PromptContext } from '@dltech/atlas-core'

export class DelegationFragment extends PromptFragment {
  readonly id = 'agents.delegation'

  override applies(ctx: PromptContext): boolean {
    return ctx.groups.includes(EPromptGroup.Delegation)
  }

  text(): string {
    return [
      'Parallelise work that splits into independent pieces: spawn sub-agents for bounded slices (a search,',
      'an audit, a review, a change to named files) in one call, and a teammate for a whole workstream that',
      'should run beside you. Do the work yourself when it is one coherent change one agent can finish in a',
      'sitting — a brief, a cold start and a wait cost more than they save.',
      'Cut slices along seams, not layers: each slice delivers something that runs and is tested on its own,',
      'including the wiring at its edges. Name in each brief who owns the integration — you, or a final',
      'slice — and what the slice may do when it needs something outside its files: make the minimal change',
      'itself, or report blocked at once. Never leave an agent waiting on another.',
      'Put paths, constraints and the expected answer in the brief, do not repeat a search you handed over,',
      'and verify the assembled whole yourself.',
    ].join('\n')
  }
}
