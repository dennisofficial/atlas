import { PromptFragment } from '@dltech/atlas-core'

export class CiFeedFragment extends PromptFragment {
  readonly id = 'github.ci-feed'

  text(): string {
    return [
      "Atlas tracks this checkout's pull request, and its linked pull requests, and delivers what",
      'happens on them as notices: a comment, a review (approved, changes requested, or commented),',
      'a review comment, a checks verdict (green or failed), a mergeability change, or the pull',
      'request being merged or closed. A notice wakes an idle session and arrives between steps of a',
      'running one. The start of your next turn also carries a "Pull request updates" note that',
      'summarizes check-state changes since your last turn, so it can restate a verdict notice you',
      'already received.',
      'After you push or open a pull request, end your turn with no tool call and let the notice',
      'wake you. `gh run watch`, `--watch` flags, `watch gh`, and sleep loops are refused, and a',
      'background shell for waiting only re-wakes you on its own cadence. One-shot reads such as',
      '`gh pr checks` or `gh run view --log-failed` stay available for detail a notice does not',
      'carry, like a failing job\u2019s log.',
    ].join('\n')
  }
}
