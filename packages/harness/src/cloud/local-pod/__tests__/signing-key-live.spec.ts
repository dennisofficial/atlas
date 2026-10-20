import { afterAll, beforeAll, describe, expect, it } from 'bun:test'

import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { DevServeBinary } from '@dltech/atlas-wire'

import { DockerEngine } from '../../../execution/docker/engine'
import { DockerPodEngine } from '../../../execution/docker/pod-engine'
import { dockerUnavailableReason } from '../../../execution/docker/__tests__/live-docker'
import { generateSigningKeyPair } from '../../openssh-keygen'
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

const SIGNING_KEY_PATH = '/atlas/home/ssh-signing-key'
const LEASE_PATH = '/v1/ssh-signing-key'
const USER_NAME = 'Atlas Live'
const USER_EMAIL = 'atlas-live@example.com'

type LivePod = { threadId: string; podName: string; token: string }

const livePod = (label: string): LivePod => {
  const threadId = `signing-key-live-${label}-${process.pid}-${randomUUID().slice(0, 8)}`
  return { threadId, podName: podNameFor({ threadId }), token: `live-${randomUUID()}` }
}

const keyedPod = livePod('keyed')
const unkeyedPod = livePod('unkeyed')

const sweepOf = async (pod: LivePod): Promise<void> => {
  const failures: unknown[] = []
  const attempt = async (work: () => Promise<void>): Promise<void> => {
    await work().catch((failure: unknown) => failures.push(failure))
  }
  await attempt(async () => {
    for (const container of await engine.listContainers({ labels: { [podThreadLabel]: pod.threadId }, all: true })) {
      await attempt(() => engine.removeContainer({ id: container.id }))
    }
  })
  for (const name of [workspaceVolumeNameFor(pod), dindVolumeNameFor(pod)]) {
    await attempt(() => pods.removeVolume({ name }))
  }
  if (failures.length > 0) throw new AggregateError(failures, `signing-key-live cleanup of ${pod.podName} left resources behind`)
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

const execIn = async (args: { pod: LivePod; script: string }) => {
  const result = await pods.execSh({ id: args.pod.podName, script: args.script, timeoutMs: 60_000 })
  return {
    exitCode: result.exitCode,
    output: `${(await result.stdout()).trim()}\n${(await result.stderr()).trim()}`.trim(),
  }
}

const ALLOWED_SIGNERS_PATH = '/atlas/home/ssh-allowed-signers'
const SERVE_LOG_PATH = '/atlas/home/operational/atlas-serve.log'

const gitConfigEntries: ReadonlyArray<readonly [key: string, value: string]> = [
  ['gpg.format', 'ssh'],
  ['user.signingkey', SIGNING_KEY_PATH],
  ['commit.gpgsign', 'true'],
  ['tag.gpgsign', 'true'],
  ['user.name', USER_NAME],
  ['user.email', USER_EMAIL],
  ['gpg.ssh.allowedSignersFile', ALLOWED_SIGNERS_PATH],
]

const GIT_CONFIG_PREAMBLE = [
  `export GIT_CONFIG_COUNT=${gitConfigEntries.length}`,
  ...gitConfigEntries.flatMap(([key, value], index) => [
    `export GIT_CONFIG_KEY_${index}=${key}`,
    `export GIT_CONFIG_VALUE_${index}=${value}`,
  ]),
].join('\n')

describeDocker('serve signs commits inside a live pod with the leased key', () => {
  let workDirectory = ''
  let devServe: DevServeBinary | undefined
  let fakeApi: ReturnType<typeof Bun.serve> | undefined
  const leaseRequests: Array<{ path: string; authorized: boolean }> = []

  const driverFor = (cloudUrl: string): DockerPodDriver =>
    new DockerPodDriver({
      image: DEFAULT_POD_IMAGE,
      socketPath: SOCKET,
      devServe: async () => {
        if (devServe === undefined) throw new Error('the dev serve was not built')
        return devServe
      },
      provisionLock: fileProvisionLock({ directory: join(tmpdir(), 'atlas-pod-locks') }),
      cloudUrl,
      home: join(workDirectory, 'home'),
      log: (line) => console.log(`[driver] ${line}`),
    })

  const birth = async (args: { driver: DockerPodDriver; pod: LivePod }): Promise<void> => {
    const placement = await args.driver.createOrResume({
      name: args.pod.podName,
      threadId: args.pod.threadId,
      token: args.pod.token,
      putContextOnFreshBoot: async (handle) => {
        await args.driver.writeBootstrapFile({
          name: handle.name,
          path: WORKSPACE_SPEC_PATH,
          content: bootstrapSpecOf({ projectId: null }),
        })
      },
    })
    expect(placement.state).toBe('running')
  }

  beforeAll(async () => {
    workDirectory = await mkdtemp(join(tmpdir(), 'atlas-signing-key-live-'))
    const keyPair = generateSigningKeyPair({ comment: 'atlas-live' })
    fakeApi = Bun.serve({
      hostname: '0.0.0.0',
      port: 0,
      fetch: (request) => {
        const path = new URL(request.url).pathname
        const authorized = request.headers.get('authorization') === `Bearer ${keyedPod.token}`
        leaseRequests.push({ path, authorized })
        if (request.method === 'GET' && path === LEASE_PATH) {
          if (!authorized) return new Response(JSON.stringify({ message: 'no key' }), { status: 404 })
          return Response.json({ ...keyPair, userName: USER_NAME, userEmail: USER_EMAIL })
        }
        console.log(`[fake-api] unexpected ${request.method} ${path}`)
        return new Response(null, { status: 204 })
      },
    })
    devServe = await buildDevServe({ directory: join(workDirectory, 'serve') })
  }, 600_000)

  afterAll(async () => {
    await fakeApi?.stop(true)
    const outcomes = await Promise.allSettled([sweepOf(keyedPod), sweepOf(unkeyedPod)])
    if (workDirectory !== '') await rm(workDirectory, { recursive: true, force: true })
    const failed = outcomes.filter((outcome) => outcome.status === 'rejected')
    if (failed.length > 0) throw new AggregateError(failed.map((outcome) => outcome.reason), 'signing-key-live cleanup failed')
  }, 180_000)

  it('verifies a commit signed by the leased key and keeps the key file private', async () => {
    const cloudUrl = `http://${await podReachableHost()}:${fakeApi?.port}`
    await birth({ driver: driverFor(cloudUrl), pod: keyedPod })

    const mode = await execIn({ pod: keyedPod, script: `stat -c %a ${SIGNING_KEY_PATH}` })
    expect(mode.output).toBe('600')

    const signed = await execIn({
      pod: keyedPod,
      script: [
        GIT_CONFIG_PREAMBLE,
        'git init -q /tmp/r && cd /tmp/r && git commit -q --allow-empty -m x && git log --show-signature -1',
      ].join('\n'),
    })
    console.log(`[git log --show-signature -1]\n${signed.output}`)

    expect(signed.exitCode).toBe(0)
    expect(signed.output).toContain('Good "git" signature')
    expect(signed.output).toContain(USER_EMAIL)
    expect(leaseRequests.some((request) => request.path === LEASE_PATH && request.authorized)).toBe(true)
  }, 600_000)

  it('leaves no key file and logs signing-key-absent when the lease answers 404', async () => {
    const cloudUrl = `http://${await podReachableHost()}:${fakeApi?.port}`
    await birth({ driver: driverFor(cloudUrl), pod: unkeyedPod })

    const absent = await execIn({
      pod: unkeyedPod,
      script: [
        `[ ! -e ${SIGNING_KEY_PATH} ] && echo key-file-absent`,
        `[ ! -e ${ALLOWED_SIGNERS_PATH} ] && echo allowed-signers-absent`,
        `grep -o 'serve.signing-key-[a-z]*' ${SERVE_LOG_PATH}`,
      ].join('\n'),
    })

    expect(absent.exitCode).toBe(0)
    expect(absent.output.split('\n')).toEqual(['key-file-absent', 'allowed-signers-absent', 'serve.signing-key-absent'])
    expect(leaseRequests.some((request) => request.path === LEASE_PATH && !request.authorized)).toBe(true)
  }, 600_000)
})
