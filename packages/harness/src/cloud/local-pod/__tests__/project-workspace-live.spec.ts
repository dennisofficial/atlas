import { afterAll, beforeAll, describe, expect, it } from 'bun:test'

import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { DevServeBinary } from '@dltech/atlas-wire'

import { DockerEngine } from '../../../execution/docker/engine'
import { DockerPodEngine } from '../../../execution/docker/pod-engine'
import { dockerUnavailableReason } from '../../../execution/docker/__tests__/live-docker'
import { bootstrapSpecOf, WORKSPACE_SPEC_PATH } from '../../local-cloud-bootstrap'
import { DockerPodDriver } from '../driver'
import {
  DEFAULT_POD_IMAGE,
  dindVolumeNameFor,
  podNameFor,
  podThreadLabel,
  workspaceVolumeNameFor,
} from '../pod-create'
import { fileProvisionLock } from '../provision-lock'
import { buildDevServe } from './dev-serve-build'

const SOCKET = '/var/run/docker.sock'
const describeDocker =
  (await dockerUnavailableReason(SOCKET)) === undefined ? describe : describe.skip

const engine = new DockerEngine({ socketPath: SOCKET })
const pods = new DockerPodEngine({ socketPath: SOCKET })

const PROJECT_ID = 'proj-live'
const WORKSPACE_PATH = `/v1/projects/${PROJECT_ID}/workspace`
const PRIMARY_DIR = '/atlas/workspaces/Hello-World'
const EXTRA_DIR = '/atlas/workspaces/Spoon-Knife'
const PRIMARY_HEAD = 'b3cbd5bbd7e81436d2eee04537ea2b4c0cad4cdf'
const EXTRA_HEAD = '58060701b538587e8b4ab127253e6ed6fbdc53d1'

type LivePod = { threadId: string; podName: string; token: string }

const livePod: LivePod = (() => {
  const threadId = `project-workspace-live-${process.pid}-${randomUUID().slice(0, 8)}`
  return { threadId, podName: podNameFor({ threadId }), token: `live-${randomUUID()}` }
})()

const sweepOf = async (pod: LivePod): Promise<void> => {
  const failures: unknown[] = []
  const attempt = async (work: () => Promise<void>): Promise<void> => {
    await work().catch((failure: unknown) => failures.push(failure))
  }
  await attempt(async () => {
    for (const container of await engine.listContainers({
      labels: { [podThreadLabel]: pod.threadId },
      all: true,
    })) {
      await attempt(() => engine.removeContainer({ id: container.id }))
    }
  })
  for (const name of [workspaceVolumeNameFor(pod), dindVolumeNameFor(pod)]) {
    await attempt(() => pods.removeVolume({ name }))
  }
  if (failures.length > 0)
    throw new AggregateError(
      failures,
      `project-workspace-live cleanup of ${pod.podName} left resources behind`,
    )
}

const dockerCli = async (args: readonly string[]): Promise<string> => {
  const child = Bun.spawn(['docker', ...args], { stdout: 'pipe', stderr: 'pipe' })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  if (exitCode !== 0) throw new Error(`docker ${args.join(' ')} exited ${exitCode}: ${stderr}`)
  return stdout.trim()
}

const podReachableHost = async (): Promise<string> =>
  process.platform === 'darwin'
    ? 'host.docker.internal'
    : await dockerCli([
        'network',
        'inspect',
        'bridge',
        '--format',
        '{{(index .IPAM.Config 0).Gateway}}',
      ])

const execIn = async (script: string) => {
  const result = await pods.execSh({ id: livePod.podName, script, timeoutMs: 60_000 })
  return {
    exitCode: result.exitCode,
    output: `${(await result.stdout()).trim()}\n${(await result.stderr()).trim()}`.trim(),
  }
}

const gitIn = async (args: { dir: string; command: string }): Promise<string> => {
  const result = await execIn(`git -c safe.directory='*' -C ${args.dir} ${args.command}`)
  expect(result.exitCode).toBe(0)
  return result.output.split('\n')[0] ?? ''
}

describeDocker('serve clones the project a bootstrap names inside a live pod', () => {
  let workDirectory = ''
  let devServe: DevServeBinary | undefined
  let fakeApi: ReturnType<typeof Bun.serve> | undefined
  const requests: Array<{ path: string; authorized: boolean }> = []

  beforeAll(async () => {
    workDirectory = await mkdtemp(join(tmpdir(), 'atlas-project-workspace-live-'))
    fakeApi = Bun.serve({
      hostname: '0.0.0.0',
      port: 0,
      fetch: (request) => {
        const path = new URL(request.url).pathname
        const authorized = request.headers.get('authorization') === `Bearer ${livePod.token}`
        requests.push({ path, authorized })
        if (request.method === 'GET' && path === WORKSPACE_PATH && authorized) {
          return Response.json({
            projectId: PROJECT_ID,
            repo: 'octocat/Hello-World',
            baseBranch: 'test',
            additionalRepos: [{ repo: 'octocat/Spoon-Knife', branch: 'test-branch' }],
            githubToken: null,
          })
        }
        return new Response(JSON.stringify({ message: 'not found' }), {
          status: path === WORKSPACE_PATH ? 401 : 404,
        })
      },
    })
    devServe = await buildDevServe({ directory: join(workDirectory, 'serve') })
  }, 600_000)

  afterAll(async () => {
    await fakeApi?.stop(true)
    const outcome = await Promise.allSettled([sweepOf(livePod)])
    if (workDirectory !== '') await rm(workDirectory, { recursive: true, force: true })
    const failed = outcome.filter((one) => one.status === 'rejected')
    if (failed.length > 0)
      throw new AggregateError(
        failed.map((one) => one.reason),
        'project-workspace-live cleanup failed',
      )
  }, 180_000)

  it('checks out each repo on its branch beside the primary, with clean origins', async () => {
    const driver = new DockerPodDriver({
      image: DEFAULT_POD_IMAGE,
      socketPath: SOCKET,
      devServe: async () => {
        if (devServe === undefined) throw new Error('the dev serve was not built')
        return devServe
      },
      provisionLock: fileProvisionLock({ directory: join(tmpdir(), 'atlas-pod-locks') }),
      cloudUrl: `http://${await podReachableHost()}:${fakeApi?.port}`,
      home: join(workDirectory, 'home'),
      log: (line) => console.log(`[driver] ${line}`),
    })

    const placement = await driver.createOrResume({
      name: livePod.podName,
      threadId: livePod.threadId,
      token: livePod.token,
      putContextOnFreshBoot: async (handle) => {
        await driver.writeBootstrapFile({
          name: handle.name,
          path: WORKSPACE_SPEC_PATH,
          content: bootstrapSpecOf({ projectId: PROJECT_ID }),
        })
      },
    })
    expect(placement.state).toBe('running')

    expect(await gitIn({ dir: PRIMARY_DIR, command: 'rev-parse --abbrev-ref HEAD' })).toBe('test')
    expect(await gitIn({ dir: PRIMARY_DIR, command: 'rev-parse HEAD' })).toBe(PRIMARY_HEAD)
    expect(await gitIn({ dir: PRIMARY_DIR, command: 'remote get-url origin' })).toBe(
      'https://github.com/octocat/Hello-World.git',
    )

    expect(await gitIn({ dir: EXTRA_DIR, command: 'rev-parse --abbrev-ref HEAD' })).toBe(
      'test-branch',
    )
    expect(await gitIn({ dir: EXTRA_DIR, command: 'rev-parse HEAD' })).toBe(EXTRA_HEAD)
    expect(await gitIn({ dir: EXTRA_DIR, command: 'remote get-url origin' })).toBe(
      'https://github.com/octocat/Spoon-Knife.git',
    )

    expect(requests.some((request) => request.path === WORKSPACE_PATH && request.authorized)).toBe(
      true,
    )
  }, 600_000)
})
