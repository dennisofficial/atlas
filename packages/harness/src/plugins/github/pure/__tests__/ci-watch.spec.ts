import { describe, expect, it } from 'bun:test'

import { ciWatchIntent, ECiWatch, type CiWatchIntent } from '../ci-watch'

const watching = (command: string): boolean => ciWatchIntent({ command }).kind === ECiWatch.Watching

const of = (command: string): string | null => {
  const intent = ciWatchIntent({ command })
  return intent.kind === ECiWatch.Watching ? intent.of : null
}

const TABLE: readonly (readonly [string, CiWatchIntent])[] = [
  ['gh run watch 123', { kind: ECiWatch.Watching, of: 'workflow-run' }],
  ['gh run view 123', { kind: ECiWatch.Reading }],
  ['gh run view 123 --watch', { kind: ECiWatch.Watching, of: 'workflow-run' }],
  [
    'while true; do gh api repos/o/r/actions/runs?per_page=1; sleep 5; done',
    { kind: ECiWatch.Watching, of: 'workflow-run' },
  ],
  ['gh pr checks --watch', { kind: ECiWatch.Watching, of: 'pull-request' }],
  ['gh pr checks', { kind: ECiWatch.Reading }],
  ['gh run list', { kind: ECiWatch.Reading }],
  ['gh run view 123 -w', { kind: ECiWatch.Watching, of: 'workflow-run' }],
  ['gh run view --job 456 --watch', { kind: ECiWatch.Watching, of: 'workflow-run' }],
  ['gh run watch 123 -j 456', { kind: ECiWatch.Watching, of: 'workflow-run' }],
  ['gh workflow view ci.yml --watch', { kind: ECiWatch.Watching, of: 'workflow-run' }],
  ['watch gh pr checks', { kind: ECiWatch.Watching, of: 'pull-request' }],
  ['watch -n 10 gh run view 123', { kind: ECiWatch.Watching, of: 'workflow-run' }],
  [
    'for i in 1 2 3; do gh api repos/o/r/actions/runs/9; sleep 5; done',
    { kind: ECiWatch.Watching, of: 'workflow-run' },
  ],
  [
    'until gh api repos/o/r/actions/runs/9/jobs; do sleep 5; done',
    { kind: ECiWatch.Watching, of: 'workflow-run' },
  ],
  ['gh run list; sleep 30', { kind: ECiWatch.Reading }],
  ['gh pr checks', { kind: ECiWatch.Reading }],
  ['gh pr view 1 --json statusCheckRollup', { kind: ECiWatch.Reading }],
  ['echo "gh run watch"', { kind: ECiWatch.Reading }],
]

describe('the intent of a bash command that touches CI', () => {
  it.each(TABLE)('%p is %p', (command, expected) => {
    expect(ciWatchIntent({ command })).toEqual(expected)
  })
})

describe('commands that wait on CI', () => {
  it('reads gh run watch in its spellings', () => {
    expect(watching('gh run watch')).toBe(true)
    expect(watching('gh run watch 123 --exit-status')).toBe(true)
    expect(watching('gh run watch --interval 120 123')).toBe(true)
    expect(watching('gh -R owner/repo run watch 123')).toBe(true)
  })

  it('reads --watch or -w on a gh run read', () => {
    expect(watching('gh run view 123 --watch')).toBe(true)
    expect(watching('gh run view 123 -w')).toBe(true)
    expect(watching('gh run view -w 123')).toBe(true)
    expect(watching('gh run view 123 --job 456 --watch')).toBe(true)
  })

  it('reads --watch on a gh pr or workflow read', () => {
    expect(watching('gh pr checks 42 --watch --fail-fast')).toBe(true)
    expect(watching('gh workflow view ci.yml --watch')).toBe(true)
  })

  it('reads watch wrapped around gh', () => {
    expect(watching('watch gh pr checks')).toBe(true)
    expect(watching('watch -n 10 gh run view 123')).toBe(true)
  })

  it('reads a while, until or for loop that sleeps between gh reads', () => {
    expect(watching('while true; do gh pr checks; sleep 30; done')).toBe(true)
    expect(watching('until gh run view 123 | grep completed; do sleep 10; done')).toBe(true)
    expect(watching('while ! gh pr checks && sleep 5; do :; done')).toBe(true)
    expect(watching('while true\ndo\n  gh run list\n  sleep 20\ndone')).toBe(true)
    expect(watching('for i in 1 2 3; do gh run list; sleep 5; done')).toBe(true)
  })

  it('reads a loop that polls the actions runs api', () => {
    expect(watching('while true; do gh api repos/o/r/actions/runs?per_page=1; sleep 5; done')).toBe(
      true,
    )
    expect(watching('until gh api /repos/o/r/actions/runs/9/jobs; do sleep 5; done')).toBe(true)
  })

  it('reads an actions api call followed by a sleep without a loop', () => {
    expect(watching('gh api repos/o/r/actions/runs/9 && sleep 10')).toBe(true)
    expect(watching('gh api /repos/o/r/actions/runs/9/jobs; sleep 10')).toBe(true)
  })

  it('reads a watch that trails another link of the chain', () => {
    expect(watching('git push && gh run watch 123')).toBe(true)
    expect(watching('git push; gh pr checks --watch | tail -5')).toBe(true)
  })

  it('reads a watch behind a program prefix', () => {
    expect(watching('FOO=1 gh run watch 123')).toBe(true)
    expect(watching('sudo gh run watch 123')).toBe(true)
  })

  it('reads a backgrounded command by its text alone', () => {
    expect(watching('gh run watch 123 &')).toBe(true)
    expect(watching('nohup gh pr checks --watch > /tmp/ci.log 2>&1 &')).toBe(true)
  })
})

describe('what a watching command watches', () => {
  it('names a pull request when the command is pr-flavoured', () => {
    expect(of('gh pr checks --watch')).toBe('pull-request')
    expect(of('watch gh pr checks')).toBe('pull-request')
    expect(of('while true; do gh pr checks; sleep 30; done')).toBe('pull-request')
  })

  it('names a workflow run when the command is run-flavoured', () => {
    expect(of('gh run watch 123')).toBe('workflow-run')
    expect(of('gh run view 123 --watch')).toBe('workflow-run')
    expect(of('gh workflow view ci.yml --watch')).toBe('workflow-run')
    expect(of('watch -n 10 gh run view 123')).toBe('workflow-run')
    expect(of('while true; do gh run list; sleep 20; done')).toBe('workflow-run')
    expect(of('gh api repos/o/r/actions/runs/9; sleep 5')).toBe('workflow-run')
  })
})

describe('commands that read once', () => {
  it('allows the one-shot gh reads', () => {
    expect(watching('gh pr checks')).toBe(false)
    expect(watching('gh pr checks 42')).toBe(false)
    expect(watching('gh pr view --json statusCheckRollup')).toBe(false)
    expect(watching('gh pr view 1 --json statusCheckRollup')).toBe(false)
    expect(watching('gh run view 123')).toBe(false)
    expect(watching('gh run view 123 --log')).toBe(false)
    expect(watching('gh run view 123 --log-failed')).toBe(false)
    expect(watching('gh run list --limit 5')).toBe(false)
    expect(watching('gh workflow view ci.yml')).toBe(false)
    expect(watching('gh api repos/o/r/actions/runs/9')).toBe(false)
  })

  it('allows gh pr view -w, which opens a browser rather than watching', () => {
    expect(watching('gh pr view 1 -w')).toBe(false)
  })

  it('keeps a quoted mention inert', () => {
    expect(watching('echo "gh run watch"')).toBe(false)
    expect(watching("echo 'gh pr checks --watch'")).toBe(false)
    expect(watching('echo "watch gh pr checks"')).toBe(false)
    expect(watching('git commit -m "docs: gh run watch is blocked"')).toBe(false)
  })

  it('allows commands that are not gh at all', () => {
    expect(watching('bun test')).toBe(false)
    expect(watching('git push -u origin HEAD')).toBe(false)
    expect(watching('tail -f server.log')).toBe(false)
    expect(watching('watch -n 2 ls')).toBe(false)
    expect(watching('bun run dev --watch')).toBe(false)
    expect(watching('bun test --watch')).toBe(false)
  })

  it('allows --watch on a gh command that is not a pr, run or workflow read', () => {
    expect(watching('gh issue list --watch')).toBe(false)
  })

  it('allows a loop that does not poll gh', () => {
    expect(watching('while true; do curl localhost:3000; sleep 1; done')).toBe(false)
    expect(watching('for i in 1 2 3; do echo $i; sleep 1; done')).toBe(false)
  })

  it('allows a gh read that merely shares a command with a sleep', () => {
    expect(watching('gh pr checks; sleep 30')).toBe(false)
    expect(watching('gh run list; sleep 30')).toBe(false)
    expect(watching('sleep 30 && gh run view 123')).toBe(false)
  })

  it('allows an empty command', () => {
    expect(watching('')).toBe(false)
    expect(watching('   ')).toBe(false)
  })
})
