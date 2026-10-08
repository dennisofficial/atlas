import { PromptFragment } from '@dltech/atlas-core'

/**
 * The pull-request service already watches the tracked checkout and hands check-state transitions
 * to the model at the start of the next turn, so CI is pushed, not pulled. A model that does not
 * know that reaches for `gh pr checks` / `gh run watch` / a watch shell and then keeps re-waking
 * itself on its own polling cadence — the loop this fragment exists to prevent. Naming the feed as
 * authoritative, and ending the turn as the way to wait, removes the reason to poll without gating
 * the tools, which stay available for the detail the transition line does not carry (a failing
 * job's log, a specific check name).
 */
export class CiFeedFragment extends PromptFragment {
  readonly id = 'github.ci-feed'

  text(): string {
    return [
      "This checkout's pull-request check state is delivered to you automatically: when a check",
      'starts, fails, or passes, the change arrives at the start of your next turn as a',
      '"Pull request updates" note. You do not need to track CI yourself.',
      'Do not run `gh pr checks`, `gh pr view`, `gh run watch`, or any CI-polling or CI-watch command',
      'to follow along, and do not start a background shell to watch checks — that re-wakes you on',
      'its own cadence and is the loop this feed exists to replace. When you have pushed and are',
      'waiting on checks, end your turn with no tool call; the transition wakes you. Reach for the',
      'CI commands only when you need detail the update does not carry, like a failing job\u2019s log',
      'or a specific check name.',
    ].join('\n')
  }
}
