import { PromptFragment } from '@dltech/atlas-core'

export class CiFeedFragment extends PromptFragment {
  readonly id = 'github.ci-feed'

  text(): string {
    return [
      "Atlas detects this checkout's pull request and shows it to the operator, but nothing about it",
      'reaches you unless a thread subscribes. After you push a branch with a pull request or open one,',
      'call `subscribe` with provider `github.pull-request` (a blank target is this checkout\u2019s pull',
      'request; if a blank target finds no pull request yet, pass `#<number>` from `gh pr create`\u2019s',
      'output), then end your turn with no tool call and let the notice wake you. A subscription',
      'delivers comments, change requests, CI failure, and merge or close at once; approvals, a green CI',
      'verdict and mergeability changes arrive together as one notice when CI settles. Every CI notice',
      'says whether CI is still running or has finished; the latest one is the truth, so never wait',
      'on a run a notice already called finished. It ends itself',
      'when the pull request merges or closes. You can subscribe to any pull request, such as one your',
      'work depends on, with `#123`, `owner/repo#123`, or its URL.',
      'A workflow run that is not a pull request\u2019s \u2014 a deploy, a nightly, a run on main \u2014 is its own',
      'subscription: call `subscribe` with provider `github.workflow-run`, with a blank target for this push\u2019s run, `#<run id>`,',
      '`owner/repo#<run id>`, a run URL, or `<workflow>@<branch>` (the workflow file or name `gh run list`',
      'shows) for the next run of it on that branch. It ends when that run finishes, and its notice names',
      'the conclusion and the failed jobs.',
      '`gh run watch`, `--watch` flags, `watch gh`, and sleep loops are refused: waiting is the',
      'subscription\u2019s job. One-shot reads such as `gh pr checks`, `gh run view <id>` and',
      '`gh run view --log-failed` stay available for detail a notice does not carry.',
    ].join('\n')
  }
}
