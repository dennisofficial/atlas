import { describe, expect, it } from 'bun:test'

import { LogPort, type LogEntry } from '@dltech/atlas-core'

import { EForge, EPullRequestLookup, EPullRequestState } from '../pure'

import { EGhPollRole, GH_TIMEOUT_MS, GhPullRequestPort } from '../gh-pull-requests'
import { ESpawnFailure } from '../run-command'
import { aCheckout, ghAnswering, ghSpawnFailure } from '../testing'

const PAYLOAD = JSON.stringify({
  isDraft: false,
  number: 42,
  state: 'OPEN',
  title: 'a change',
  url: 'https://github.com/dennisofficial/atlas/pull/42',
  statusCheckRollup: null,
})

describe('GhPullRequestPort', () => {
  it('asks gh for exactly the nine fields, in the checkout directory', async () => {
    const run = ghAnswering({ stdout: PAYLOAD })
    const port = new GhPullRequestPort({ run })

    await port.read({ checkout: aCheckout({ directory: '/work/atlas/.claude/worktrees/thing' }) })

    expect(run.calls).toEqual([
      {
        argv: [
          'gh',
          'pr',
          'view',
          '--json',
          'number,state,isDraft,url,headRefOid,statusCheckRollup,title,mergeable,comments,reviews',
        ],
        cwd: '/work/atlas/.claude/worktrees/thing',
        timeoutMs: GH_TIMEOUT_MS,
      },
    ])
  })

  it('does not push, so the service keeps its timer', () => {
    expect(new GhPullRequestPort({ run: ghAnswering() }).pushes).toBe(false)
  })

  it('finds the pull request on exit 0', async () => {
    const port = new GhPullRequestPort({ run: ghAnswering({ stdout: PAYLOAD }) })
    const reading = await port.read({ checkout: aCheckout() })

    expect(reading.lookup).toBe(EPullRequestLookup.Found)
    if (reading.lookup !== EPullRequestLookup.Found) return
    expect(reading.pullRequest.number).toBe(42)
    expect(reading.pullRequest.state).toBe(EPullRequestState.Open)
  })

  it('is absent when gh says the branch has no pull request', async () => {
    const port = new GhPullRequestPort({
      run: ghAnswering({ code: 1, stderr: 'no pull requests found for branch "main"\n' }),
    })

    expect((await port.read({ checkout: aCheckout() })).lookup).toBe(EPullRequestLookup.Absent)
  })

  it('is unavailable and retryable when the directory is not a repository', async () => {
    const port = new GhPullRequestPort({
      run: ghAnswering({
        code: 1,
        stderr: 'failed to run git: fatal: not a git repository (or any of the parent directories)',
      }),
    })
    const reading = await port.read({ checkout: aCheckout() })

    expect(reading).toEqual({ lookup: EPullRequestLookup.Unavailable, retryable: true })
  })

  it('is unavailable and retryable when the network fails', async () => {
    const port = new GhPullRequestPort({
      run: ghAnswering({ code: 1, stderr: 'dial tcp: lookup api.github.com: no such host' }),
    })

    expect(await port.read({ checkout: aCheckout() })).toEqual({
      lookup: EPullRequestLookup.Unavailable,
      retryable: true,
    })
  })

  it('is unavailable and not retryable when gh is not authenticated', async () => {
    const port = new GhPullRequestPort({
      run: ghAnswering({ code: 4, stderr: 'gh auth login required' }),
    })

    expect(await port.read({ checkout: aCheckout() })).toEqual({
      lookup: EPullRequestLookup.Unavailable,
      retryable: false,
    })
  })

  it('latches a missing gh binary and never spawns again', async () => {
    const run = ghAnswering(ghSpawnFailure({ failure: ESpawnFailure.BinaryMissing }))
    const port = new GhPullRequestPort({ run })

    const first = await port.read({ checkout: aCheckout() })
    const second = await port.read({ checkout: aCheckout() })

    expect(first).toEqual({ lookup: EPullRequestLookup.Unavailable, retryable: false })
    expect(second).toEqual({ lookup: EPullRequestLookup.Unavailable, retryable: false })
    expect(run.calls).toHaveLength(1)
  })

  /**
   * A worktree removed mid-session must not kill pull-request lookup for every other repository in
   * the process, which is what latching on any spawn failure would do.
   */
  it('does not latch when the working directory is the thing that is gone', async () => {
    const run = ghAnswering(ghSpawnFailure({ failure: ESpawnFailure.DirectoryUnusable }), {
      stdout: PAYLOAD,
    })
    const port = new GhPullRequestPort({ run })

    const gone = await port.read({ checkout: aCheckout({ directory: '/removed/worktree' }) })
    const elsewhere = await port.read({ checkout: aCheckout() })

    expect(gone).toEqual({ lookup: EPullRequestLookup.Unavailable, retryable: true })
    expect(elsewhere.lookup).toBe(EPullRequestLookup.Found)
    expect(run.calls).toHaveLength(2)
  })

  it('does not latch on a spawn failure it cannot name', async () => {
    const run = ghAnswering(ghSpawnFailure({ failure: ESpawnFailure.Other }), { stdout: PAYLOAD })
    const port = new GhPullRequestPort({ run })

    const first = await port.read({ checkout: aCheckout() })
    const second = await port.read({ checkout: aCheckout() })

    expect(first).toEqual({ lookup: EPullRequestLookup.Unavailable, retryable: true })
    expect(second.lookup).toBe(EPullRequestLookup.Found)
  })

  it('is unavailable and retryable when a killed gh leaves no json behind', async () => {
    const port = new GhPullRequestPort({ run: ghAnswering({ code: 143, stderr: '' }) })

    expect(await port.read({ checkout: aCheckout() })).toEqual({
      lookup: EPullRequestLookup.Unavailable,
      retryable: true,
    })
  })

  it('is unavailable and retryable when exit 0 carries garbage', async () => {
    const port = new GhPullRequestPort({ run: ghAnswering({ stdout: '<html>login</html>' }) })

    expect(await port.read({ checkout: aCheckout() })).toEqual({
      lookup: EPullRequestLookup.Unavailable,
      retryable: true,
    })
  })

  it('reports a forge that is definitely not github as unavailable, never as absent', async () => {
    const run = ghAnswering({ stdout: PAYLOAD })
    const port = new GhPullRequestPort({ run })

    const reading = await port.read({ checkout: aCheckout({ forge: EForge.Other }) })

    expect(reading).toEqual({ lookup: EPullRequestLookup.Unavailable, retryable: false })
    expect(run.calls).toHaveLength(0)
  })

  it('still asks on an unknown host, where gh enterprise may be configured', async () => {
    const run = ghAnswering({ stdout: PAYLOAD })
    const port = new GhPullRequestPort({ run })

    await port.read({ checkout: aCheckout({ forge: EForge.Unknown }) })

    expect(run.calls).toHaveLength(1)
  })
})

describe('GhPullRequestPort.readLinked', () => {
  const LINK = { repo: 'github.com/dennisofficial/atlas', number: 42 }

  it('asks gh by number and repo, from the process directory rather than a checkout', async () => {
    const run = ghAnswering({ stdout: PAYLOAD })
    const port = new GhPullRequestPort({ run })

    const reading = await port.readLinked(LINK)

    expect(run.calls).toEqual([
      {
        argv: [
          'gh',
          'pr',
          'view',
          '42',
          '--repo',
          'github.com/dennisofficial/atlas',
          '--json',
          'number,state,isDraft,url,headRefOid,statusCheckRollup,title,mergeable,comments,reviews',
        ],
        cwd: process.cwd(),
        timeoutMs: GH_TIMEOUT_MS,
      },
    ])
    expect(reading.lookup).toBe(EPullRequestLookup.Found)
    if (reading.lookup !== EPullRequestLookup.Found) return
    expect(reading.pullRequest.number).toBe(42)
  })

  it('is absent when gh says there is no such pull request', async () => {
    const port = new GhPullRequestPort({
      run: ghAnswering({ code: 1, stderr: 'no pull requests found\n' }),
    })

    expect((await port.readLinked(LINK)).lookup).toBe(EPullRequestLookup.Absent)
  })

  it('maps failures exactly as read does', async () => {
    const unauthenticated = new GhPullRequestPort({
      run: ghAnswering({ code: 4, stderr: 'gh auth login required' }),
    })
    expect(await unauthenticated.readLinked(LINK)).toEqual({
      lookup: EPullRequestLookup.Unavailable,
      retryable: false,
    })

    const garbage = new GhPullRequestPort({ run: ghAnswering({ stdout: '<html>login</html>' }) })
    expect(await garbage.readLinked(LINK)).toEqual({
      lookup: EPullRequestLookup.Unavailable,
      retryable: true,
    })
  })

  it('shares the missing-binary latch with read', async () => {
    const run = ghAnswering(ghSpawnFailure({ failure: ESpawnFailure.BinaryMissing }))
    const port = new GhPullRequestPort({ run })

    await port.readLinked(LINK)
    const after = await port.read({ checkout: aCheckout() })

    expect(after).toEqual({ lookup: EPullRequestLookup.Unavailable, retryable: false })
    expect(run.calls).toHaveLength(1)
  })
})

class RecordingLog extends LogPort {
  readonly entries: LogEntry[] = []

  record(entry: LogEntry): void {
    this.entries.push(entry)
  }
}

describe('GhPullRequestPort call log', () => {
  it('logs one entry per checkout spawn with role, kind, target and outcome', async () => {
    const log = new RecordingLog()
    const port = new GhPullRequestPort({
      run: ghAnswering({ stdout: PAYLOAD }),
      log,
      role: EGhPollRole.FailoverFallback,
    })

    await port.read({ checkout: aCheckout({ directory: '/work/atlas/thing' }) })

    expect(log.entries).toHaveLength(1)
    expect(log.entries[0]?.source).toBe('github.gh-call')
    expect(log.entries[0]?.message).toBe('gh pr view')
    expect(log.entries[0]?.data).toMatchObject({
      role: 'failover-fallback',
      kind: 'checkout',
      target: 'thing',
      exitCode: 0,
      failure: null,
      outcome: 'found',
    })
    expect(typeof log.entries[0]?.data?.durationMs).toBe('number')
    expect(JSON.stringify(log.entries[0])).not.toContain('a change')
  })

  it('defaults to signed-out and logs linked targets as repo#number', async () => {
    const log = new RecordingLog()
    const port = new GhPullRequestPort({
      run: ghAnswering({ code: 1, stderr: 'no pull requests found' }),
      log,
    })

    await port.readLinked({ repo: 'github.com/dennisofficial/atlas', number: 7 })

    expect(log.entries[0]?.data).toMatchObject({
      role: 'signed-out',
      kind: 'linked',
      target: 'github.com/dennisofficial/atlas#7',
      exitCode: 1,
      outcome: 'absent',
    })
  })

  it('logs unavailable with the spawn failure, then nothing once gh is known missing', async () => {
    const log = new RecordingLog()
    const run = ghAnswering(ghSpawnFailure({ failure: ESpawnFailure.BinaryMissing }))
    const port = new GhPullRequestPort({ run, log })

    await port.read({ checkout: aCheckout() })
    await port.read({ checkout: aCheckout() })

    expect(log.entries).toHaveLength(1)
    expect(log.entries[0]?.data).toMatchObject({
      failure: ESpawnFailure.BinaryMissing,
      outcome: 'unavailable',
    })
  })

  it('does not log for a non-GitHub forge', async () => {
    const log = new RecordingLog()
    const port = new GhPullRequestPort({ run: ghAnswering(), log })

    await port.read({ checkout: aCheckout({ forge: EForge.Other }) })

    expect(log.entries).toHaveLength(0)
  })
})
