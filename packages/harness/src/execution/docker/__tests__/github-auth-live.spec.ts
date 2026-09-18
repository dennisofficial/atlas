import { describe, expect, it } from 'bun:test'

import { randomUUID } from 'node:crypto'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { DockerEngine } from '../engine'
import { hostSandboxEnvironment, sandboxConfigFromHost } from '../host-environment'
import {
  DEFAULT_DOCKER_SOCKET,
  DEFAULT_SANDBOX_IMAGE,
  ensureSandbox,
  worktreeLabel,
} from '../sandbox'
import { runSandboxScript } from '../sandbox-scripts'
import { describeLiveDocker } from './live-docker'

const SOCKET = process.env.ATLAS_DOCKER_SOCKET ?? DEFAULT_DOCKER_SOCKET
const PREFIX = `atlas-dev-github-auth-${process.pid}-${randomUUID()}`
const engine = new DockerEngine({ socketPath: SOCKET })

const githubToken = hostSandboxEnvironment().githubToken
if (githubToken === undefined) {
  console.warn('Skipping live github auth: the host probe found no gh token (gh auth token)')
}
const origin = ((): string | undefined => {
  const probed = Bun.spawnSync(['git', 'remote', 'get-url', 'origin'])
  if (!probed.success) return undefined
  const url = new TextDecoder().decode(probed.stdout).trim()
  return url.includes('github.com') ? url : undefined
})()
if (origin === undefined) {
  console.warn('Skipping live github auth: this checkout has no github.com origin to push at')
}

const describeDocker =
  githubToken === undefined || origin === undefined
    ? describe.skip
    : await describeLiveDocker({ socket: SOCKET, what: 'live github auth' })

describeDocker('github auth against a live daemon', () => {
  it('pushes to the repository over the ssh remote, authenticated by the gh token', async () => {
    const worktree = await realpath(await mkdtemp(join(tmpdir(), 'atlas-github-auth-')))
    const branch = `atlas-live-github-auth-${process.pid}-${randomUUID().slice(0, 8)}`
    const config = {
      ...sandboxConfigFromHost({
        worktree,
        session: worktree,
        image: DEFAULT_SANDBOX_IMAGE,
        limits: { cpus: 1, memoryBytes: 512 * 1024 ** 2 },
        labelPrefix: PREFIX,
        atlasHomeSubtrees: [],
      }),
      dockerSocket: SOCKET,
    }
    expect(config.githubToken).toBeDefined()

    const sandbox = await ensureSandbox({ engine, config })
    try {
      const script = [
        'set -eu',
        "test \"$(git config credential.https://github.com.helper)\" = '!gh auth git-credential'",
        "git config --get-all url.https://github.com/.insteadOf | grep -qx 'git@github.com:'",
        "printf 'protocol=https\\nhost=github.com\\n\\n' | git credential fill | grep -q '^username='",
        'git init -b main .',
        'git config user.name "Atlas Live Auth"',
        'git config user.email atlas-live-auth@example.invalid',
        'git config commit.gpgsign false',
        'printf probe > probe.txt',
        'git add probe.txt',
        'git commit -qm probe',
        `git remote add origin '${origin}'`,
        `git push -q origin HEAD:refs/heads/${branch}`,
        `git push -q origin --delete ${branch}`,
        `test -z "$(git ls-remote origin 'refs/heads/${branch}')"`,
      ].join('\n')
      const outcome = await runSandboxScript({
        engine,
        containerId: sandbox.id,
        script,
        cwd: worktree,
      })
      expect(
        outcome.exitCode,
        outcome.output.replaceAll(config.githubToken ?? '', '<redacted>'),
      ).toBe(0)
    } finally {
      const owned = await engine.listContainers({ labels: { [worktreeLabel(PREFIX)]: undefined }, all: true })
      for (const container of owned) await engine.removeContainer({ id: container.id })
      await rm(worktree, { recursive: true, force: true })
    }
  }, 300_000)
})
