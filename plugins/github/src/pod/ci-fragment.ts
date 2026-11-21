import { PromptFragment } from '@dltech/atlas-core'

export class CiFeedFragment extends PromptFragment {
  readonly id = 'github.ci-feed'

  text(): string {
    return [
      "Atlas detects this project directory's pull request and shows it to the operator, but nothing",
      'about it reaches you unless a thread subscribes. After you push a branch with a pull request or',
      'open one, call `subscription` with action subscribe and provider `github.pull-request`. A blank target is this project',
      'directory\u2019s pull request. If a blank target finds no pull request yet, pass `#<number>` from',
      '`gh pr create`\u2019s output. Then end your turn with no tool call and let the notice wake you. A',
      'subscription delivers comments, change requests, CI failure, and merge or close at once.',
      'Approvals, a green CI verdict and mergeability changes arrive together as one notice when CI',
      'settles. Every CI notice says whether CI is still running or has finished. The latest notice is',
      'the truth. Never wait on a run that a notice already called finished. The subscription ends',
      'itself when the pull request merges or closes. You can subscribe to any pull request, such as',
      'one your work depends on, with `#123`, `owner/repo#123`, or its URL.',
      'When you only wait for someone else\u2019s pull request to merge, subscribe with',
      "`events: ['state']` so comments and CI do not wake you. A notice that needs no action gets a",
      'one-line reply.',
      'A workflow run that is not a pull request\u2019s \u2014 a deploy, a nightly, a run on main \u2014 is its own',
      'subscription. Call `subscription` with action subscribe and provider `github.workflow-run`. Pass a blank target for this',
      'push\u2019s run, `#<run id>`, `owner/repo#<run id>` or a run URL for one specific run. The',
      'subscription ends when that run finishes. Use `<workflow>@<branch>` for every completed run of',
      'that workflow on that branch. Use the workflow file or name that `gh run list` shows. A notice',
      'arrives for each completed run until the thread ends. Each notice names the conclusion and the',
      'failed jobs.',
      '`gh run watch`, `--watch` flags, `watch gh`, and sleep loops are refused. Waiting is the',
      'subscription\u2019s job. One-shot reads such as `gh pr checks`, `gh run view <id>` and',
      '`gh run view --log-failed` stay available for detail that a notice does not carry.',
    ].join('\n')
  }
}
