import { PromptFragment } from '@dltech/atlas-core'

export class CiFeedFragment extends PromptFragment {
  readonly id = 'github.ci-feed'

  text(): string {
    return [
      "Atlas detects this checkout's pull request and shows it to the operator, but nothing about it",
      'reaches you unless a thread subscribes. After you push a branch with a pull request or open one,',
      'call `subscribe` with provider `github.pull-request` (a blank target is this checkout\u2019s pull',
      'request), then end your turn with no tool call and let the notice wake you. A subscription',
      'delivers comments, reviews, and merge or close at once; a CI failure at once; and a green CI',
      'verdict and mergeability changes as one batched notice when CI settles. It ends itself when the',
      'pull request merges or closes. You can subscribe to any pull request, such as one your work',
      'depends on, with `#123`, `owner/repo#123`, or its URL. `gh run watch`, `--watch` flags,',
      '`watch gh`, and sleep loops are refused on a subscribed pull request. One-shot reads such as',
      '`gh pr checks` or `gh run view --log-failed` stay available for detail a notice does not',
      'carry, like a failing job\u2019s log.',
    ].join('\n')
  }
}
