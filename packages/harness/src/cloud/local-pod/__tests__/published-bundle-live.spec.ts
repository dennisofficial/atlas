import { afterAll, beforeAll, describe, expect, it } from 'bun:test'

import { createHash, randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { DevServeBinary } from '@dltech/atlas-wire'

import { DockerEngine } from '../../../execution/docker/engine'
import { DockerPodEngine } from '../../../execution/docker/pod-engine'
import { dockerUnavailableReason } from '../../../execution/docker/__tests__/live-docker'
import { buildContextArchive } from '../../context-archive'
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
const describeDocker = (await dockerUnavailableReason(SOCKET)) === undefined ? describe : describe.skip

const engine = new DockerEngine({ socketPath: SOCKET })
const pods = new DockerPodEngine({ socketPath: SOCKET })

const CURRENT_PATH = '/v1/published-bundles/current'
const BLOB_PATH = '/blob/bundle.tar.gz'
const SKILL_KEY = 'user-layer/skills/.agents/live-pushed/SKILL.md'
const SKILL_PATH = '/atlas/home/.agents/skills/live-pushed/SKILL.md'
const SKILL_BODY = '---\nname: live-pushed\ndescription: pushed from a live spec\n---\nlive pushed body\n'
const SERVE_LOG_PATH = '/atlas/home/operational/atlas-serve.log'
const POLL_BUDGET_MS = 30_000

type LivePod = { threadId: string; podName: string; token: string }

const threadId = `published-bundle-live-${process.pid}-${randomUUID().slice(0, 8)}`
const pod: LivePod = { threadId, podName: podNameFor({ threadId }), token: `live-${randomUUID()}` }

const sweepOf = async (target: LivePod): Promise<void> => {
  const failures: unknown[] = []
  const attempt = async (work: () => Promise<void>): Promise<void> => {
    await work().catch((failure: unknown) => failures.push(failure))
  }
  await attempt(async () => {
    for (const container of await engine.listContainers({ labels: { [podThreadLabel]: target.threadId }, all: true })) {
      await attempt(() => engine.removeContainer({ id: container.id }))
    }
  })
  for (const name of [workspaceVolumeNameFor(target), dindVolumeNameFor(target)]) {
    await attempt(() => pods.removeVolume({ name }))
  }
  if (failures.length > 0) throw new AggregateError(failures, `published-bundle-live cleanup of ${target.podName} left resources behind`)
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
    : await dockerCli(['network', 'inspect', 'bridge', '--format', '{{(index .IPAM.Config 0).Gateway}}'])

const execIn = async (script: string) => {
  const result = await pods.execSh({ id: pod.podName, script, timeoutMs: 60_000 })
  return {
    exitCode: result.exitCode,
    output: `${(await result.stdout()).trim()}\n${(await result.stderr()).trim()}`.trim(),
  }
}

const pollUntil = async (check: () => Promise<boolean>): Promise<boolean> => {
  const deadline = Date.now() + POLL_BUDGET_MS
  while (Date.now() < deadline) {
    if (await check()) return true
    await new Promise((resolve) => setTimeout(resolve, 1_000))
  }
  return false
}

describeDocker('serve applies the published bundle inside a live pod', () => {
  let workDirectory = ''
  let devServe: DevServeBinary | undefined
  let fakeApi: ReturnType<typeof Bun.serve> | undefined
  let hostOrigin = ''
  const requests: Array<{ path: string; authorized: boolean }> = []

  beforeAll(async () => {
    workDirectory = await mkdtemp(join(tmpdir(), 'atlas-published-bundle-live-'))
    const sourcePath = join(workDirectory, 'source', 'SKILL.md')
    await mkdir(join(workDirectory, 'source'), { recursive: true })
    await writeFile(sourcePath, SKILL_BODY)
    const tarball = await buildContextArchive({ files: [{ key: SKILL_KEY, path: sourcePath }] })
    if (tarball === undefined) throw new Error('the bundle tarball was not built')
    const sha256 = createHash('sha256').update(tarball).digest('hex')

    fakeApi = Bun.serve({
      hostname: '0.0.0.0',
      port: 0,
      fetch: (request) => {
        const path = new URL(request.url).pathname
        const authorized = request.headers.get('authorization') === `Bearer ${pod.token}`
        requests.push({ path, authorized })
        if (request.method === 'GET' && path === CURRENT_PATH) {
          if (!authorized) return new Response(JSON.stringify({ message: 'unauthorized' }), { status: 401 })
          return Response.json({
            version: 1,
            sha256,
            sizeBytes: tarball.byteLength,
            manifest: { skills: ['.agents/live-pushed'], instructions: [], mcp: false },
            createdAt: new Date().toISOString(),
            downloadUrl: `${hostOrigin}${BLOB_PATH}`,
          })
        }
        if (request.method === 'GET' && path === BLOB_PATH) return new Response(tarball)
        console.log(`[fake-api] unexpected ${request.method} ${path}`)
        return new Response(null, { status: 204 })
      },
    })
    devServe = await buildDevServe({ directory: join(workDirectory, 'serve') })
  }, 600_000)

  afterAll(async () => {
    await fakeApi?.stop(true)
    const outcome = await Promise.allSettled([sweepOf(pod)])
    if (workDirectory !== '') await rm(workDirectory, { recursive: true, force: true })
    const failed = outcome.filter((result) => result.status === 'rejected')
    if (failed.length > 0) throw new AggregateError(failed.map((result) => result.reason), 'published-bundle-live cleanup failed')
  }, 180_000)

  it('lands the pushed skill in the pod home and logs bundle-ready', async () => {
    hostOrigin = `http://${await podReachableHost()}:${fakeApi?.port}`
    const driver = new DockerPodDriver({
      image: DEFAULT_POD_IMAGE,
      socketPath: SOCKET,
      devServe: async () => {
        if (devServe === undefined) throw new Error('the dev serve was not built')
        return devServe
      },
      provisionLock: fileProvisionLock({ directory: join(tmpdir(), 'atlas-pod-locks') }),
      cloudUrl: hostOrigin,
      home: join(workDirectory, 'home'),
      log: (line) => console.log(`[driver] ${line}`),
    })
    const placement = await driver.createOrResume({
      name: pod.podName,
      threadId: pod.threadId,
      token: pod.token,
      putContextOnFreshBoot: async (handle) => {
        await driver.writeBootstrapFile({
          name: handle.name,
          path: WORKSPACE_SPEC_PATH,
          content: bootstrapSpecOf({ workspace: null, gitToken: undefined }),
        })
      },
    })
    expect(placement.state).toBe('running')

    const landed = await pollUntil(async () => (await execIn(`cat ${SKILL_PATH}`)).output.includes('live pushed body'))
    const content = await execIn(`cat ${SKILL_PATH}`)
    console.log(`[${SKILL_PATH}]\n${content.output}`)
    expect(landed).toBe(true)
    expect(content.output).toBe(SKILL_BODY.trim())

    const logged = await execIn(`grep -o 'serve.bundle-[a-z]*' ${SERVE_LOG_PATH}`)
    expect(logged.output.split('\n')).toContain('serve.bundle-ready')
    expect(requests.some((request) => request.path === CURRENT_PATH && request.authorized)).toBe(true)
    expect(requests.some((request) => request.path === BLOB_PATH && !request.authorized)).toBe(true)
  }, 600_000)
})
