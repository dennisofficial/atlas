import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'

import { createEnvironmentProfile, EProfileStep, EProfileStepState } from '../environment-profile'
import { isolatedEnv, isolatedGit, isolatedRunner } from './isolated-git-gpg'

const toolsAvailable = Bun.which('git') !== null && Bun.which('gpg') !== null
const describeReal = toolsAvailable ? describe : describe.skip

const IDENTITY = { name: 'Atlas Probe', email: 'probe@example.com' }
const KEY_UID = 'Atlas Probe <probe@example.com>'

describeReal('environment profile with real git and gpg (skipped when git or gpg is missing)', () => {
  const root = toolsAvailable ? mkdtempSync('/tmp/apg-') : ''
  const homeDir = join(root, 'h')
  const keygenHome = join(root, 'k')
  const targetGnupg = join(root, 'g')
  const repo = join(root, 'r')
  const keygenEnv = isolatedEnv({ home: homeDir, gnupgHome: keygenHome })
  const targetEnv = isolatedEnv({ home: homeDir, gnupgHome: targetGnupg })
  const targetRun = isolatedRunner(targetEnv)
  const profileRun: typeof targetRun = async (args) => {
    if (args.command[0] === 'docker') return { ok: true, stdout: '', stderr: '' }
    if (args.command[0] === 'ssh-keyscan') {
      return { ok: true, stdout: 'github.com ssh-ed25519 probe\n', stderr: '' }
    }
    return targetRun(args)
  }
  const targetGit = isolatedGit(targetEnv)
  const keygenRun = isolatedRunner(keygenEnv)
  let fingerprint = ''
  let gpgKey = ''

  const sh = async (command: readonly string[], cwd: string = root, stdin?: string) => {
    const result = await targetRun({ command, cwd, stdin })
    if (!result.ok) throw new Error(`${command[0]} ${command[1] ?? ''} failed: ${result.stderr.trim()}`)
    return result
  }

  const keygen = async (command: readonly string[]) => {
    const result = await keygenRun({ command, cwd: root })
    if (!result.ok) throw new Error(`${command[0]} ${command[1] ?? ''} failed: ${result.stderr.trim()}`)
    return result
  }

  const snapshot = async (): Promise<string> => {
    const head = await sh(['git', 'rev-parse', 'HEAD'], repo)
    const status = await sh(['git', 'status', '--porcelain=v1', '--ignored'], repo)
    const refs = await sh(['git', 'for-each-ref', 'refs/heads', 'refs/tags', 'refs/remotes'], repo)
    const index = await Bun.file(join(repo, '.git', 'index')).bytes()
    const indexHash = new Bun.CryptoHasher('sha256').update(index).digest('hex')
    return [head.stdout, status.stdout, refs.stdout, indexHash].join('|')
  }

  beforeAll(async () => {
    for (const dir of [homeDir, keygenHome, targetGnupg, repo]) {
      await sh(['mkdir', '-m', '700', dir])
    }
    await keygen(['gpg', '--batch', '--passphrase', '', '--quick-gen-key', KEY_UID, 'ed25519', 'sign', '0'])
    const listing = await keygen(['gpg', '--batch', '--with-colons', '--list-secret-keys'])
    fingerprint = listing.stdout.split('\n').find((line) => line.startsWith('fpr:'))?.split(':')[9] ?? ''
    const secret = await keygen(['gpg', '--batch', '--armor', '--export-secret-keys', fingerprint])
    const pub = await keygen(['gpg', '--batch', '--armor', '--export', fingerprint])
    const trust = await keygen(['gpg', '--batch', '--export-ownertrust'])
    gpgKey = JSON.stringify({
      keyId: fingerprint,
      secretKey: secret.stdout,
      publicKey: pub.stdout,
      ownerTrust: trust.stdout,
      sign: true,
    })
    await keygenRun({ command: ['gpgconf', '--kill', 'gpg-agent'], cwd: root })

    await sh(['git', 'init', '-q', '-b', 'main'], repo)
    await sh(['git', 'config', 'user.name', 'Seed'], repo)
    await sh(['git', 'config', 'user.email', 'seed@example.com'], repo)
    await sh(['git', 'config', 'commit.gpgsign', 'false'], repo)
    await Bun.write(join(repo, 'tracked.txt'), 'tracked\n')
    await sh(['git', 'add', 'tracked.txt'], repo)
    await sh(['git', 'commit', '-q', '-m', 'seed'], repo)
    await Bun.write(join(repo, 'untracked.txt'), 'untracked\n')
  })

  afterAll(async () => {
    await keygenRun({ command: ['gpgconf', '--kill', 'gpg-agent'], cwd: root })
    await targetRun({ command: ['gpgconf', '--kill', 'gpg-agent'], cwd: root })
    rmSync(root, { recursive: true, force: true })
  })

  it('imports an ephemeral key, proves signing with a real probe and leaves repo state alone', async () => {
    const before = await snapshot()
    const apply = createEnvironmentProfile({ env: {}, home: homeDir, run: profileRun, git: targetGit })

    const profile = await apply({
      cwd: repo,
      spec: {
        remoteUrl: 'git@github.com:dennisofficial/atlas.git',
        branch: 'main',
        commit: null,
        patch: '',
        githubToken: null,
        contextBundle: null,
        gitIdentity: IDENTITY,
        gpgKey,
      },
    })

    const outcomes = Object.fromEntries(profile.steps.map((one) => [one.step, one]))
    expect(outcomes[EProfileStep.GitIdentity]?.state).toBe(EProfileStepState.Applied)
    expect(outcomes[EProfileStep.GpgSigning]?.state).toBe(EProfileStepState.Applied)
    expect(profile.capabilities.gpgSigning).toBe(true)
    expect(profile.capabilities.gitIdentity).toBe('Atlas Probe <probe@example.com>')
    expect(JSON.stringify(profile)).not.toContain('PRIVATE KEY')

    expect(await snapshot()).toBe(before)
    const config = await sh(['git', 'config', '--local', '--list'], repo)
    expect(config.stdout).toContain(`user.signingkey=${fingerprint}`)
    expect(config.stdout).toContain('gpg.format=openpgp')
    expect(config.stdout).toContain('gpg.program=gpg')
    expect(config.stdout).toContain('commit.gpgsign=true')
    expect(await Bun.file(join(repo, '.git', 'config.lock')).exists()).toBe(false)
  })

  it('produces commits whose verified signature carries the generated fingerprint', async () => {
    const tree = (await sh(['git', 'mktree'], repo, '')).stdout.trim()
    const commit = (
      await sh(['git', 'commit-tree', tree, '-S', '-m', 'fingerprint check'], repo)
    ).stdout.trim()

    const verified = await targetRun({
      command: ['git', 'verify-commit', '--raw', commit],
      cwd: repo,
    })

    expect(verified.ok).toBe(true)
    expect(verified.stderr).toContain(`VALIDSIG ${fingerprint}`)
  })

  it('reports signing unavailable when the imported key cannot sign', async () => {
    const stale = JSON.stringify({ ...JSON.parse(gpgKey), keyId: '0'.repeat(40) })
    const apply = createEnvironmentProfile({ env: {}, home: homeDir, run: profileRun, git: targetGit })

    const profile = await apply({
      cwd: repo,
      spec: {
        remoteUrl: 'git@github.com:dennisofficial/atlas.git',
        branch: 'main',
        commit: null,
        patch: '',
        githubToken: null,
        contextBundle: null,
        gpgKey: stale,
      },
    })

    expect(profile.capabilities.gpgSigning).toBe(false)
    expect(profile.steps.find((one) => one.step === EProfileStep.GpgSigning)?.state).toBe(
      EProfileStepState.Failed,
    )
  })
})
