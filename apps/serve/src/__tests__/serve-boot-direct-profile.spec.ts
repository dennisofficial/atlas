import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'bun:test'
import { toThreadId } from '@dltech/atlas-core'
import type { RestoredWorkspace } from '@dltech/atlas-harness'

import { EProfileStep, EProfileStepState } from '../environment-profile'
import { EWorkspaceState } from '../materialize-workspace'
import { EServeEvent } from '../serve-log'
import { bootServeFiles } from '../serve-boot'
import { TOKEN, harness, outcomeOf, seededScan } from './environment-profile-fixture'

const RESTORED = '/workspace/restored'
const threadId = toThreadId('thread-direct-profile')

const GPG_MATERIAL = {
  keyId: 'ABCD1234',
  publicKey: '-----BEGIN PGP PUBLIC KEY BLOCK-----pub',
  secretKey: '-----BEGIN PGP PRIVATE KEY BLOCK-----sec',
  ownerTrust: 'ABCD1234:6:',
  sign: true,
}

const roots: string[] = []

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

const restoredAt = (cwd: string): RestoredWorkspace => ({
  cwd,
  repository: cwd,
  trees: [{ id: 'main', sourcePath: '/host/repo', path: cwd, branch: null, renamedFrom: null }],
})

const bootDirect = async (args: {
  spec: Record<string, unknown>
  runFails?: Parameters<typeof harness>[0]['runFails']
}) => {
  const root = await mkdtemp(join(tmpdir(), 'atlas-direct-profile-'))
  roots.push(root)
  const driveHome = join(root, 'home')
  await mkdir(join(driveHome, 'bootstrap'), { recursive: true })
  await writeFile(
    join(driveHome, 'bootstrap', 'workspace-spec.json'),
    JSON.stringify({
      remoteUrl: 'git@github.com:dennisofficial/atlas.git',
      branch: 'main',
      commit: null,
      patch: '',
      githubToken: TOKEN,
      ...args.spec,
    }),
  )
  await writeFile(join(driveHome, 'bootstrap', 'workspace.tar.gz'), 'generation')
  const fixture = harness({
    present: [`${RESTORED}/.git`],
    runAnswers: seededScan,
    runFails: args.runFails,
  })
  const lines: string[] = []
  const booted = await bootServeFiles({
    env: fixture.env,
    threadId,
    cwd: join(root, 'workspace'),
    driveHome,
    log: (line) => lines.push(JSON.stringify(line)),
    restoreWorkspace: async () => restoredAt(RESTORED),
    profile: fixture.apply,
    fetchTranscriptArchive: async () => null,
  })
  return { ...fixture, booted, lines }
}

describe('the environment profile on a direct-archive boot', () => {
  it('applies git identity and imports the gpg key against the restored cwd', async () => {
    const { booted, gitAttempts, commands } = await bootDirect({
      spec: {
        gitIdentity: { name: 'Dennis', email: 'dennis@example.com' },
        gpgKey: JSON.stringify(GPG_MATERIAL),
      },
    })

    expect(booted.directBoot.kind).toBe('ready')
    if (booted.workspace.state === EWorkspaceState.Failed) throw new Error('workspace failed')
    expect(booted.workspace.state).toBe(EWorkspaceState.Present)
    const profile = booted.workspace.profile
    if (profile === undefined) throw new Error('the profile did not run on the direct path')
    expect(outcomeOf(profile, EProfileStep.GitIdentity).state).toBe(EProfileStepState.Applied)
    expect(outcomeOf(profile, EProfileStep.GpgSigning).state).toBe(EProfileStepState.Applied)
    expect(gitAttempts.map((one) => [one.cwd, ...one.args])).toContainEqual([
      RESTORED,
      'config',
      'user.name',
      'Dennis',
    ])
    expect(
      commands.some(
        (one) => one.command.join(' ') === 'gpg --batch --import' && one.cwd === RESTORED,
      ),
    ).toBe(true)
  })

  it('reports the credential step applied and leaves the token armed in the env', async () => {
    const { booted, env } = await bootDirect({ spec: {} })

    if (booted.workspace.state === EWorkspaceState.Failed) throw new Error('workspace failed')
    const profile = booted.workspace.profile
    if (profile === undefined) throw new Error('the profile did not run on the direct path')
    expect(outcomeOf(profile, EProfileStep.Credentials).state).toBe(EProfileStepState.Applied)
    expect(env.GH_TOKEN).toBe(TOKEN)
  })

  it('logs a failed profile step as ProfileStepFailed', async () => {
    const { lines } = await bootDirect({
      spec: { gpgKey: JSON.stringify(GPG_MATERIAL) },
      runFails: (attempt) =>
        attempt.command[0] === 'gpg' ? { stderr: 'gpg: no keyring' } : undefined,
    })

    const failed = lines.filter((line) => line.includes(EServeEvent.ProfileStepFailed))
    expect(failed).toHaveLength(1)
    expect(failed[0]).toContain(EProfileStep.GpgSigning)
    expect(failed[0]).toContain('gpg: no keyring')
  })
})
