import { describe, expect, it } from 'bun:test'

import { ciWatchIntent, ECiWatch } from '../ci-watch'

const watching = (command: string): boolean =>
  ciWatchIntent({ command }) === ECiWatch.Watching

describe('commands that wait on CI', () => {
  it('reads gh run watch in its spellings', () => {
    expect(watching('gh run watch')).toBe(true)
    expect(watching('gh run watch 123')).toBe(true)
    expect(watching('gh run watch 123 --exit-status')).toBe(true)
    expect(watching('gh run watch --interval 120 123')).toBe(true)
    expect(watching('gh -R owner/repo run watch 123')).toBe(true)
  })

  it('reads --watch on a gh pr, run or workflow read', () => {
    expect(watching('gh pr checks --watch')).toBe(true)
    expect(watching('gh pr checks 42 --watch --fail-fast')).toBe(true)
    expect(watching('gh run view 123 --watch')).toBe(true)
    expect(watching('gh workflow view ci.yml --watch')).toBe(true)
  })

  it('reads watch wrapped around gh', () => {
    expect(watching('watch gh pr checks')).toBe(true)
    expect(watching('watch -n 10 gh run view 123')).toBe(true)
  })

  it('reads a while or until loop that sleeps between gh reads', () => {
    expect(watching('while true; do gh pr checks; sleep 30; done')).toBe(true)
    expect(watching('until gh run view 123 | grep completed; do sleep 10; done')).toBe(true)
    expect(watching('while ! gh pr checks && sleep 5; do :; done')).toBe(true)
    expect(watching('while true\ndo\n  gh run list\n  sleep 20\ndone')).toBe(true)
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

describe('commands that read once', () => {
  it('allows the one-shot gh reads', () => {
    expect(watching('gh pr checks')).toBe(false)
    expect(watching('gh pr checks 42')).toBe(false)
    expect(watching('gh pr view --json statusCheckRollup')).toBe(false)
    expect(watching('gh run view 123')).toBe(false)
    expect(watching('gh run view 123 --log')).toBe(false)
    expect(watching('gh run view 123 --log-failed')).toBe(false)
    expect(watching('gh run list --limit 5')).toBe(false)
    expect(watching('gh workflow view ci.yml')).toBe(false)
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
    expect(watching('sleep 30 && gh run view 123')).toBe(false)
  })

  it('allows an empty command', () => {
    expect(watching('')).toBe(false)
    expect(watching('   ')).toBe(false)
  })
})
