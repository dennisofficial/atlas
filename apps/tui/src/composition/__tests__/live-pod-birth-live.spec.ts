import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { EExecutionLocation, ERunner, toThreadId } from '@dltech/atlas-core'
import {
  atlasDirectory,
  birthInCloud,
  BIRTH_WAVES,
  CloudClient,
  createLocalPodBridge,
  DEFAULT_DOCKER_SOCKET,
  DockerEngine,
  ERuntimeKind,
  pingDocker,
  podHomeDigestOf,
  podHomeLabel,
  podNameFor,
  podThreadLabel,
  storedModel,
  type CloudBridge,
} from '@dltech/atlas-harness'

import { EProjectAnswer, type ProjectRequest } from '../../ui/project-prompt-model'
import {
  beginMove,
  EStepMark,
  settleMoveNode,
  startMoveNode,
  type ContainerMove,
} from '../container-move'
import { resolveProject } from '../cloud/use-project-resolution'
import { liveBridgeFor, livePodBridgeOptionsFor } from '../live-pod'
import { fakeApp, fakeCloud, scriptedModelPort } from './fake-app'
import { fakeSessionRuntime } from './fake-session-runtime'

const SOCKET = process.env.ATLAS_DOCKER_SOCKET ?? DEFAULT_DOCKER_SOCKET
const enabled =
  process.env.ATLAS_LIVE_DOCKER === '1' && (await pingDocker({ socketPath: SOCKET })) === undefined
const describeLive = enabled ? describe : describe.skip

const THREAD = toThreadId(`brn_tui_live_pod_${process.pid}`)
const PROJECT_THREAD = toThreadId(`brn_tui_live_pod_project_${process.pid}`)
const LIVE_TIMEOUT_MS = 20 * 60_000

const PROJECT_ID = 'proj-live'
const PROJECT_REPO = 'octocat/Hello-World'
const PROJECT_ORIGIN = `https://github.com/${PROJECT_REPO}.git`
const PRIMARY_DIR = '/atlas/workspaces/Hello-World'
const PRIMARY_HEAD = 'b3cbd5bbd7e81436d2eee04537ea2b4c0cad4cdf'
const PROJECT = {
  id: PROJECT_ID,
  name: 'Hello-World',
  repo: PROJECT_REPO,
  baseBranch: 'test',
  additionalRepos: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}
const WORKSPACE = {
  projectId: PROJECT_ID,
  repo: PROJECT_REPO,
  baseBranch: 'test',
  additionalRepos: [],
  githubToken: null,
}

type ActiveRow = { text: string; atMs: number }

const activeRowSpy = () => {
  const began = Date.now()
  let move: ContainerMove | null = null
  const seen: ActiveRow[] = []
  const record = (): void => {
    const active = move?.rows.find((row) => row.mark === EStepMark.Active)
    if (active !== undefined && seen.at(-1)?.text !== active.text)
      seen.push({ text: active.text, atMs: Date.now() - began })
  }
  return {
    seen,
    finalMarks: () => move?.rows.map((row) => row.mark) ?? [],
    onBegin: ({ waves }: { waves: typeof BIRTH_WAVES }) => {
      move = beginMove({
        target: EExecutionLocation.Cloud,
        now: 0,
        rows: waves.map((wave) => ({
          id: wave.ids[0] ?? wave.label,
          text: wave.label,
          nodeIds: wave.ids,
        })),
      })
    },
    onNodeStart: (nodeId: string) => {
      if (move !== null) move = startMoveNode({ move, nodeId, now: 0 })
      record()
    },
    onNodeDone: (nodeId: string) => {
      if (move !== null) move = settleMoveNode({ move, nodeId, now: 0 })
      record()
    },
  }
}

type Lease = { path: string; auth: string | null; body: { token: string } }
type ApiRead = { path: string; auth: string | null }

const run = async (args: { command: readonly string[]; cwd?: string }): Promise<string> => {
  const child = Bun.spawn([...args.command], {
    stdout: 'pipe',
    stderr: 'pipe',
    ...(args.cwd === undefined ? {} : { cwd: args.cwd }),
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  if (exitCode !== 0) throw new Error(`${args.command.join(' ')} exited ${exitCode}: ${stderr}`)
  return stdout.trim()
}

const podReachableHost = async (): Promise<string> =>
  process.platform === 'darwin'
    ? 'host.docker.internal'
    : await run({
        command: [
          'docker',
          'network',
          'inspect',
          'bridge',
          '--format',
          '{{(index .IPAM.Config 0).Gateway}}',
        ],
      })

const gitInPod = (args: { podName: string; command: string }): Promise<string> =>
  run({
    command: [
      'docker',
      'exec',
      args.podName,
      'sh',
      '-c',
      `git -c safe.directory='*' -C ${PRIMARY_DIR} ${args.command}`,
    ],
  })

describeLive('a pod birth through the live TUI wiring', () => {
  const leases: Lease[] = []
  const reads: ApiRead[] = []
  let server: ReturnType<typeof Bun.serve>
  let launchDirectory = ''

  beforeAll(async () => {
    launchDirectory = await mkdtemp(join(tmpdir(), 'atlas-live-pod-project-'))
    await run({ command: ['git', 'init', '-q', launchDirectory] })
    await run({ command: ['git', 'remote', 'add', 'origin', PROJECT_ORIGIN], cwd: launchDirectory })
    server = Bun.serve({
      port: 0,
      hostname: '0.0.0.0',
      fetch: async (request) => {
        const path = new URL(request.url).pathname
        const auth = request.headers.get('authorization')
        if (request.method === 'GET') {
          reads.push({ path, auth })
          if (path === '/v1/trpc/projects.list')
            return Response.json({ result: { data: [PROJECT] } })
          if (path === '/v1/trpc/projectWorkspace.get')
            return Response.json({ result: { data: WORKSPACE } })
          return Response.json({ message: 'not found' }, { status: 404 })
        }
        leases.push({ path, auth, body: (await request.json()) as { token: string } })
        return new Response(null, { status: 204 })
      },
    })
  })

  afterAll(async () => {
    await server.stop(true)
    if (launchDirectory !== '') await rm(launchDirectory, { recursive: true, force: true })
  })

  it(
    'leases the token, runs a labelled pod that answers health, and marks the thread local',
    async () => {
      const app = fakeApp({
        pods: true,
        model: scriptedModelPort({ script: { thinking: '', reply: 'ok' } }),
        cloud: fakeCloud({
          session: { url: `http://127.0.0.1:${server.port}`, token: 'live-session', email: null },
        }),
      })
      const bridge: CloudBridge = liveBridgeFor(app)({ runner: ERunner.Local })
      const spy = activeRowSpy()
      try {
        await app.sessionOwner.placement.activate({ threadId: THREAD })

        const born = await birthInCloud({
          threadId: THREAD,
          projectId: null,
          runner: ERunner.Local,
          identity: app.workspace,
          model: storedModel(app.model.choice()),
          bridge,
          localThreads: app.threads,
          ids: app.ids,
          placement: app.sessionOwner,
          onBegin: spy.onBegin,
          onNodeStart: spy.onNodeStart,
          onNodeDone: spy.onNodeDone,
          open: async ({ prepareRuntime }) =>
            prepareRuntime({
              kind: ERuntimeKind.Cloud,
              cwd: '/atlas/workspaces',
              adapters: fakeSessionRuntime(app),
            }),
        })

        if (!born.ok) throw new Error(`birth failed: ${born.detail}`)
        expect(spy.seen.map((row) => row.text)).toEqual([
          'waiting for the pod',
          'setting up the workspace',
        ])
        expect(spy.finalMarks()).toEqual([EStepMark.Done, EStepMark.Done])
        const lease = leases.find((held) => held.path === `/v1/pod-leases/${THREAD}`)
        expect(lease?.auth).toBe('Bearer live-session')
        expect(lease?.body.token).toBe(born.sandbox.token)

        const pods = await new DockerEngine({ socketPath: SOCKET }).listContainers({
          labels: { [podThreadLabel]: THREAD },
          all: false,
        })
        expect(pods).toHaveLength(1)
        expect(pods[0]?.name.replace(/^\//, '')).toStartWith('atlas-pod-')
        expect(pods[0]?.labels[podHomeLabel]).toBe(podHomeDigestOf({ home: atlasDirectory() }))

        const health = await fetch(`${born.sandbox.url}/v1/health`, {
          headers: { authorization: `Bearer ${born.sandbox.token}` },
        })
        expect(health.status).toBe(200)
        expect((await app.threads.find({ threadId: THREAD }))?.runner).toBe(ERunner.Local)
      } finally {
        await bridge.sandboxes.destroy({ threadId: THREAD })
      }
    },
    LIVE_TIMEOUT_MS,
  )

  it(
    'matches the launch repo to its project silently and clones it on the project branch inside the pod',
    async () => {
      const session = { url: `http://127.0.0.1:${server.port}`, token: 'live-session', email: null }
      const client = new CloudClient({ url: session.url, token: session.token })
      const app = fakeApp({
        pods: true,
        model: scriptedModelPort({ script: { thinking: '', reply: 'ok' } }),
        cloud: fakeCloud({ session, client }),
        cwd: launchDirectory,
      })
      const podOptions = livePodBridgeOptionsFor(app)
      const podCloudUrl = `http://${await podReachableHost()}:${server.port}`
      const bridge: CloudBridge = createLocalPodBridge({
        ...podOptions,
        pod: () => ({ ...podOptions.pod(), cloudUrl: podCloudUrl }),
      })
      const prompts: ProjectRequest[] = []

      try {
        const resolution = await resolveProject({
          cwd: app.config.cwd,
          client: app.cloud.client(),
          ask: async (request) => {
            prompts.push(request)
            return { kind: EProjectAnswer.Cancelled }
          },
        })
        expect(prompts).toHaveLength(0)
        expect(resolution).toEqual({ projectId: PROJECT_ID })
        if (resolution === 'cancelled') throw new Error('project resolution was cancelled')

        await app.sessionOwner.placement.activate({ threadId: PROJECT_THREAD })
        const born = await birthInCloud({
          threadId: PROJECT_THREAD,
          projectId: resolution.projectId,
          runner: ERunner.Local,
          identity: app.workspace,
          model: storedModel(app.model.choice()),
          bridge,
          localThreads: app.threads,
          ids: app.ids,
          placement: app.sessionOwner,
          open: async ({ prepareRuntime }) =>
            prepareRuntime({
              kind: ERuntimeKind.Cloud,
              cwd: '/atlas/workspaces',
              adapters: fakeSessionRuntime(app),
            }),
        })
        if (!born.ok) throw new Error(`birth failed: ${born.detail}`)

        const podName = podNameFor({ threadId: PROJECT_THREAD })
        expect(podName).toStartWith('atlas-pod-')
        expect(await gitInPod({ podName, command: 'rev-parse --abbrev-ref HEAD' })).toBe('test')
        expect(await gitInPod({ podName, command: 'rev-parse HEAD' })).toBe(PRIMARY_HEAD)
        expect(await gitInPod({ podName, command: 'remote get-url origin' })).toBe(PROJECT_ORIGIN)

        expect(
          reads.some(
            (read) => read.path === '/v1/trpc/projects.list' && read.auth === 'Bearer live-session',
          ),
        ).toBe(true)
        expect(
          reads.some(
            (read) =>
              read.path === '/v1/trpc/projectWorkspace.get' &&
              read.auth === `Bearer ${born.sandbox.token}`,
          ),
        ).toBe(true)
        expect((await app.threads.find({ threadId: PROJECT_THREAD }))?.projectId).toBe(PROJECT_ID)
      } finally {
        await bridge.sandboxes.destroy({ threadId: PROJECT_THREAD })
      }
    },
    LIVE_TIMEOUT_MS,
  )
})
