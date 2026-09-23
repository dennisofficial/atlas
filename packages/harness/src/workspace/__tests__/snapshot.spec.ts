import { describe, expect, it } from 'bun:test'

import type { GitRun } from '../run-git'
import { captureWorkspace, type GitReader } from '../snapshot'

const ok = (stdout: string): GitRun => ({ ok: true, stdout, stderr: '' })

const refused = (stderr = ''): GitRun => ({ ok: false, stdout: '', stderr })

const HEAD_SHA = '9f1c2ab3e4d5'

const INSIDE_A_REPO = {
  'rev-parse --is-inside-work-tree': ok('true\n'),
  'rev-parse HEAD': ok(`${HEAD_SHA}\n`),
  [`diff --binary ${HEAD_SHA}`]: ok(''),
  'ls-files --others --exclude-standard': ok(''),
}

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

describe('the git identity a snapshot carries', () => {
  it('resolves the operator identity from git config', async () => {
    const { read } = reader({
      ...INSIDE_A_REPO,
      'config user.name': ok('Dennis Lysenko\n'),
      'config user.email': ok('dennis@comp.ai\n'),
    })

    const captured = await captureWorkspace({ cwd: '/work', read })

    expect(captured?.gitIdentity).toEqual({ name: 'Dennis Lysenko', email: 'dennis@comp.ai' })
  })

  it('carries no identity when user.email is missing', async () => {
    const { read } = reader({
      ...INSIDE_A_REPO,
      'config user.name': ok('Dennis Lysenko\n'),
    })

    expect((await captureWorkspace({ cwd: '/work', read }))?.gitIdentity).toBeNull()
  })

  it('carries no identity when user.name is empty', async () => {
    const { read } = reader({
      ...INSIDE_A_REPO,
      'config user.name': ok('\n'),
      'config user.email': ok('dennis@comp.ai\n'),
    })

    expect((await captureWorkspace({ cwd: '/work', read }))?.gitIdentity).toBeNull()
  })

  it('leaves the rest of the snapshot intact when the identity reads fail', async () => {
    const { read } = reader({
      ...INSIDE_A_REPO,
      remote: ok('origin\n'),
      'remote get-url origin': ok('git@github.com:comp-ai/atlas.git\n'),
      'rev-parse --abbrev-ref HEAD': ok('dennis/env-profile\n'),
    })

    const captured = await captureWorkspace({ cwd: '/work', read })

    expect(captured?.gitIdentity).toBeNull()
    expect(captured).toEqual({
      remoteUrl: 'git@github.com:comp-ai/atlas.git',
      branch: 'dennis/env-profile',
      commit: HEAD_SHA,
      patch: '',
      projectDirectory: '/work',
      gitIdentity: null,
    })
  })
})
