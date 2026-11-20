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
      "When you only wait for someone else\u2019s pull request to land, subscribe with `events: ['state']`",
      'so comments and CI do not wake you. A notice that needs no action gets a one-line reply.',
      'A workflow run that is not a pull request\u2019s \u2014 a deploy, a nightly, a run on main \u2014 is its own',
      'subscription: call `subscribe` with provider `github.workflow-run`, with a blank target for this',
      'push\u2019s run, `#<run id>`, `owner/repo#<run id>` or a run URL for one specific run, which ends when',
      'that run finishes. `<workflow>@<branch>` (the workflow file or name `gh run list` shows) reports',
      'every run of that workflow on that branch that finishes from then on, one notice per run, until',
      'the thread ends. Each notice names the conclusion and the failed jobs.',
      '`gh run watch`, `--watch` flags, `watch gh`, and sleep loops are refused: waiting is the',
      'subscription\u2019s job. One-shot reads such as `gh pr checks`, `gh run view <id>` and',
      '`gh run view --log-failed` stay available for detail a notice does not carry.',
    ].join('\n')
  }
}
