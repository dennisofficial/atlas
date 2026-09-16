import { describe, expect, it } from 'bun:test'

import type { GitRun } from '@dltech/atlas-harness'

import { captureWorkspace, uncommittedPatch, type GitReader } from '../workspace-snapshot'

const ok = (stdout: string): GitRun => ({ ok: true, stdout, stderr: '' })

const refused = (stderr = ''): GitRun => ({ ok: false, stdout: '', stderr })

const differs = (stdout: string): GitRun => ({ ok: false, stdout, stderr: '' })

const HEAD_SHA = '9f1c2ab3e4d5'

const TRACKED_DIFF = 'diff --git a/src/app.ts b/src/app.ts\n@@\n-old\n+new\n'

const UNTRACKED_DIFF = 'diff --git a/notes.md b/notes.md\nnew file mode 100644\n'

const INSIDE_A_REPO = { 'rev-parse --is-inside-work-tree': ok('true\n') }

const reader = (answers: Record<string, GitRun>): { read: GitReader; calls: string[] } => {
  const calls: string[] = []
  return {
    calls,
    read: async ({ args }) => {
      const key = args.join(' ')
      calls.push(key)
      return answers[key] ?? refused()
    },
  }
}

describe('the git identity a lift sends with the sandbox', () => {
  it('reads the origin url, the branch and the commit', async () => {
    const { read } = reader({
      ...INSIDE_A_REPO,
      remote: ok('origin\nupstream\n'),
      'remote get-url origin': ok('git@github.com:comp-ai/atlas.git\n'),
      'rev-parse --abbrev-ref HEAD': ok('dennis/container-cloud\n'),
      'rev-parse HEAD': ok(`${HEAD_SHA}\n`),
      [`diff --binary ${HEAD_SHA}`]: ok(''),
      'ls-files --others --exclude-standard': ok(''),
    })

    expect(await captureWorkspace({ cwd: '/work', read })).toEqual({
      remoteUrl: 'git@github.com:comp-ai/atlas.git',
      branch: 'dennis/container-cloud',
      commit: HEAD_SHA,
      patch: '',
    })
  })

  it('falls back to the first remote when there is no origin', async () => {
    const { read } = reader({
      ...INSIDE_A_REPO,
      remote: ok('fork\n'),
      'remote get-url fork': ok('git@github.com:someone/atlas.git\n'),
      'rev-parse HEAD': ok(`${HEAD_SHA}\n`),
    })

    expect((await captureWorkspace({ cwd: '/work', read }))?.remoteUrl).toBe(
      'git@github.com:someone/atlas.git',
    )
  })

  it('reports a detached head as no branch rather than as a branch called HEAD', async () => {
    const { read } = reader({
      ...INSIDE_A_REPO,
      'rev-parse --abbrev-ref HEAD': ok('HEAD\n'),
      'rev-parse HEAD': ok(`${HEAD_SHA}\n`),
    })

    expect((await captureWorkspace({ cwd: '/work', read }))?.branch).toBeNull()
  })

  it('sends no workspace at all when there is no repository here', async () => {
    const { read } = reader({})

    expect(await captureWorkspace({ cwd: '/tmp', read })).toBeNull()
  })

  it('diffs against the commit it reports, not against the symbolic HEAD', async () => {
    const { read, calls } = reader({
      ...INSIDE_A_REPO,
      'rev-parse HEAD': ok(`${HEAD_SHA}\n`),
      [`diff --binary ${HEAD_SHA}`]: ok(TRACKED_DIFF),
      'ls-files --others --exclude-standard': ok(''),
    })

    const captured = await captureWorkspace({ cwd: '/work', read })

    expect(captured?.commit).toBe(HEAD_SHA)
    expect(captured?.patch).toBe(TRACKED_DIFF)
    expect(calls).toContain(`diff --binary ${HEAD_SHA}`)
    expect(calls).not.toContain('diff --binary HEAD')
  })

  it('carries nothing tracked when the repository has no commit yet', async () => {
    const { read, calls } = reader({
      ...INSIDE_A_REPO,
      'ls-files --others --exclude-standard': ok('notes.md\n'),
      'diff --no-index --binary -- /dev/null notes.md': differs(UNTRACKED_DIFF),
    })

    const captured = await captureWorkspace({ cwd: '/work', read })

    expect(captured?.commit).toBeNull()
    expect(captured?.patch).toBe(UNTRACKED_DIFF)
    expect(calls.some((call) => call.startsWith('diff --binary'))).toBe(false)
  })
})

describe('the uncommitted work a lift carries', () => {
  it('is empty on a clean tree', async () => {
    const { read } = reader({
      [`diff --binary ${HEAD_SHA}`]: ok(''),
      'ls-files --others --exclude-standard': ok(''),
    })

    expect(await uncommittedPatch({ cwd: '/work', since: HEAD_SHA, read })).toBe('')
  })

  it('carries tracked edits and untracked files in one patch', async () => {
    const { read } = reader({
      [`diff --binary ${HEAD_SHA}`]: ok(TRACKED_DIFF),
      'ls-files --others --exclude-standard': ok('notes.md\n'),
      'diff --no-index --binary -- /dev/null notes.md': differs(UNTRACKED_DIFF),
    })

    expect(await uncommittedPatch({ cwd: '/work', since: HEAD_SHA, read })).toBe(
      `${TRACKED_DIFF}${UNTRACKED_DIFF}`,
    )
  })

  it('never commits, stashes or stages to move the work', async () => {
    const { read, calls } = reader({
      [`diff --binary ${HEAD_SHA}`]: ok(TRACKED_DIFF),
      'ls-files --others --exclude-standard': ok('notes.md\n'),
      'diff --no-index --binary -- /dev/null notes.md': differs(UNTRACKED_DIFF),
    })

    await uncommittedPatch({ cwd: '/work', since: HEAD_SHA, read })

    expect(calls.some((call) => /^(commit|stash|add)\b/.test(call))).toBe(false)
  })
})
