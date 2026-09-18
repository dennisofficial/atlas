import { expect, it } from 'bun:test'

import { randomUUID } from 'node:crypto'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe } from 'bun:test'

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
const describeDocker =
  githubToken === undefined
    ? describe.skip
    : await describeLiveDocker({ socket: SOCKET, what: 'live github auth' })

describeDocker('github auth against a live daemon', () => {
  it('answers github credential asks with the gh token and rewrites ssh remotes to https', async () => {
    const worktree = await realpath(await mkdtemp(join(tmpdir(), 'atlas-github-auth-')))
    const config = {
      ...sandboxConfigFromHost({
        worktree,
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
        'git ls-remote git@github.com:dennisofficial/atlas.git HEAD | grep -q HEAD',
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
