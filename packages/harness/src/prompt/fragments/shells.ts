import { PromptFragment } from '@dltech/atlas-core'

export class BackgroundShellsFragment extends PromptFragment {
  readonly id = 'shells.background'

  text(): string {
    return [
      'Atlas delivers background shell results, service exits, sub-agent answers, and teammate reports to you automatically.',
      'Incoming notices wake an idle turn or arrive at the next boundary of a running turn.',
      'Continue independent work, or end your turn while waiting.',
    ].join(' ')
  }
}
