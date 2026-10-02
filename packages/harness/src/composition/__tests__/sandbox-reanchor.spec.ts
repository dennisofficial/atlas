import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'bun:test'

import {
  ATLAS_SETTINGS,
  EExecutionLocation,
  ProcessPort,
  toThreadId,
} from '@dltech/atlas-core'
import {
  createHarnessContainer,
  createSettingsService,
  MemorySettingsStore,
  type DockerEngine,
} from '@dltech/atlas-harness'

import { portToken } from '../../container/injection'
import { ESandboxState } from '../../execution/docker/status'
import { worktreeLabel, sessionLabel } from '../../execution/docker/sandbox'
import { recordingNotices } from './fakes'
import { createExecutionLocationState } from '../execution-location-state'
import { bindSandbox } from '../sandbox-binding'

const THREAD = toThreadId('reanchor-thread')

type FakeContainer = { id: string; labels: Record<string, string>; binds: readonly string[]; workingDir: string }

const statefulEngine = () => {
  const containers: FakeContainer[] = []
  const removals: string[] = []
  let failListing = false

  const engine = {
    info: async () => ({ cpus: 64, memoryBytes: 1024 ** 4 }),
    listContainers: async (query: { labels: Record<string, string | undefined> }) => {
      if (failListing) throw new Error('daemon dropped the listing')
      return containers
        .filter((one) =>
          Object.entries(query.labels).every(([key, value]) => one.labels[key] === value),
        )
        .map((one) => ({ id: one.id, name: one.id, state: 'running', labels: one.labels }))
    },
    inspectContainer: async (args: { id: string }) => {
      const found = containers.find((one) => one.id === args.id)
      return {
        id: args.id,
        name: args.id,
        state: { running: true },
        config: { labels: found?.labels ?? {}, env: [], image: 'node:22-slim' },
        mounts: [],
        ports: [],
        hostConfig: { nanoCpus: 0, memoryBytes: 0 },
      }
    },
    listNetworks: async () => [{ id: 'net', name: 'net', labels: {} }],
    createNetwork: async () => ({ id: 'net' }),
    removeNetwork: async () => undefined,
    createContainer: async (args: {
      body: { Labels?: Record<string, string>; HostConfig?: { Binds?: readonly string[] }; WorkingDir?: string }
    }) => {
      const id = `container-${containers.length + removals.length + 1}`
      containers.push({
        id,
        labels: args.body.Labels ?? {},
        binds: args.body.HostConfig?.Binds ?? [],
        workingDir: args.body.WorkingDir ?? '',
      })
      return { id, warnings: [] }
    },
    removeContainer: async (args: { id: string }) => {
      removals.push(args.id)
      const at = containers.findIndex((one) => one.id === args.id)
      if (at !== -1) containers.splice(at, 1)
    },
    stopContainer: async () => undefined,
    startContainer: async () => undefined,
    createExec: async () => ({ id: 'exec' }),
    startExec: async () => new ReadableStream<Uint8Array>({ start: (controller) => controller.close() }),
    inspectExec: async () => ({ running: false, exitCode: 0 }),
    images: { listImages: async () => [], buildImage: async () => undefined },
  }

  return {
    engine: engine as unknown as DockerEngine,
    containers,
    removals,
    failListing: () => {
      failListing = true
    },
  }
}

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((one) => rm(one, { recursive: true, force: true })))
})

const freshDirectory = async (containerJson?: string): Promise<string> => {
  const directory = await mkdtemp(join(tmpdir(), 'atlas-reanchor-'))
  directories.push(directory)
  if (containerJson !== undefined) {
    await mkdir(join(directory, '.atlas'))
    await writeFile(join(directory, '.atlas', 'container.json'), containerJson)
  }
  return directory
}

const bindAt = async (args: { cwd: string; engine: DockerEngine }) => {
  const container = createHarnessContainer()
  const bound = await bindSandbox({
    container,
    engine: args.engine,
    cwd: args.cwd,
    sessionKey: () => 'reanchor-session',
    settings: createSettingsService({
      definitions: ATLAS_SETTINGS,
      user: new MemorySettingsStore({ label: 'reanchor spec' }),
    }),
    executionLocation: createExecutionLocationState({ initial: EExecutionLocation.Docker }),
    notice: recordingNotices().port,
    atlasHome: join(args.cwd, 'no-atlas-home-here'),
  })
  const processes = container.resolve(portToken(ProcessPort))
  const run = async (cwd: string): Promise<void> => {
    await processes.spawn({ cmd: ['true'], cwd, threadId: THREAD }).exited
  }
  return { ...bound, run }
}

const SHARED = '/Users/operator/Developer/shared-lib'

describe('SandboxControl.prepareWorkspace', () => {
  it('mounts the boot directory until the session is re-anchored', async () => {
    const boot = await freshDirectory()
    const fake = statefulEngine()
    const { run } = await bindAt({ cwd: boot, engine: fake.engine })

    await run(boot)

    expect(fake.containers).toHaveLength(1)
    expect(fake.containers[0]?.binds).toContain(`${boot}:${boot}`)
  })

  it('replaces the boot-mounted sandbox with one mounted at the restored tree', async () => {
    const boot = await freshDirectory()
    const tree = await freshDirectory()
    const fake = statefulEngine()
    const { run, sandbox } = await bindAt({ cwd: boot, engine: fake.engine })
    await run(boot)
    const first = fake.containers[0]?.id

    await sandbox.prepareWorkspace({ cwd: tree, threadId: THREAD })
    expect(fake.removals).toEqual([first ?? ''])

    await run(tree)
    expect(fake.containers).toHaveLength(1)
    const rebuilt = fake.containers[0]
    expect(rebuilt?.binds).toContain(`${tree}:${tree}`)
    expect(rebuilt?.binds).not.toContain(`${boot}:${boot}`)
    expect(rebuilt?.workingDir).toBe(tree)
    expect(rebuilt?.labels[worktreeLabel('atlas')]).toBe(tree)
    expect(rebuilt?.labels[sessionLabel('atlas')]).toBe('reanchor-session')
  })

  it('never starts the engine on its own: with nothing running it only retargets', async () => {
    const boot = await freshDirectory()
    const tree = await freshDirectory()
    const fake = statefulEngine()
    const { sandbox } = await bindAt({ cwd: boot, engine: fake.engine })

    await sandbox.prepareWorkspace({ cwd: tree, threadId: THREAD })

    expect(fake.containers).toHaveLength(0)
    expect(fake.removals).toEqual([])
  })

  it('resolves the mounts and image label from the restored tree, with a stable status snapshot', async () => {
    const boot = await freshDirectory()
    const tree = await freshDirectory(JSON.stringify({ image: 'custom/tree-image:1', mounts: [{ path: SHARED }] }))
    const fake = statefulEngine()
    const { sandbox, mounts, containerStatus } = await bindAt({ cwd: boot, engine: fake.engine })
    expect(mounts).toEqual([])
    const before = containerStatus.current()
    expect(containerStatus.current()).toBe(before)

    await sandbox.prepareWorkspace({ cwd: tree, threadId: THREAD })

    expect(mounts).toEqual([SHARED])
    const after = containerStatus.current()
    expect(after.image).toBe('custom/tree-image:1')
    expect(after.label).toBe('tree-image:1')
    expect(after).not.toBe(before)
    expect(containerStatus.current()).toBe(after)
  })

  it('treats a directory inside the anchor as the anchor and does not rebuild', async () => {
    const boot = await freshDirectory()
    const fake = statefulEngine()
    const { run, sandbox } = await bindAt({ cwd: boot, engine: fake.engine })
    await run(boot)
    const before = fake.containers[0]?.id

    await sandbox.prepareWorkspace({ cwd: join(boot, 'packages', 'app'), threadId: THREAD })

    expect(fake.removals).toEqual([])
    expect(fake.containers.map((one) => one.id)).toEqual([before ?? ''])
  })

  it('marks the container stopped when it removes a running sandbox', async () => {
    const boot = await freshDirectory()
    const tree = await freshDirectory()
    const fake = statefulEngine()
    const { run, sandbox, containerStatus } = await bindAt({ cwd: boot, engine: fake.engine })
    await run(boot)

    await sandbox.prepareWorkspace({ cwd: tree, threadId: THREAD })

    expect(containerStatus.current().state).toBe(ESandboxState.Stopped)
  })

  it('rejects, leaving the old sandbox, when the daemon cannot be asked', async () => {
    const boot = await freshDirectory()
    const tree = await freshDirectory()
    const fake = statefulEngine()
    const { run, sandbox } = await bindAt({ cwd: boot, engine: fake.engine })
    await run(boot)
    fake.failListing()

    await expect(sandbox.prepareWorkspace({ cwd: tree, threadId: THREAD })).rejects.toThrow(
      'daemon dropped the listing',
    )
    expect(fake.containers).toHaveLength(1)
  })

  describe('with a linked worktree nested under the booted checkout', () => {
    const git = (cwd: string, ...args: string[]): void => {
      const run = Bun.spawnSync(
        ['git', '-c', 'user.name=atlas', '-c', 'user.email=atlas@example.com', ...args],
        { cwd, stdout: 'ignore', stderr: 'pipe' },
      )
      if (!run.success) throw new Error(run.stderr.toString())
    }

    const repoWithNestedTree = async (): Promise<{ repo: string; tree: string }> => {
      const repo = await realpath(await freshDirectory())
      git(repo, 'init', '-q', '-b', 'main')
      await writeFile(join(repo, 'tracked.txt'), 'main')
      git(repo, 'add', '.')
      git(repo, 'commit', '-q', '-m', 'init')
      const tree = join(repo, '.atlas', 'worktrees', 'feature-4abc')
      git(repo, 'worktree', 'add', '-q', tree, '-b', 'feature')
      return { repo, tree }
    }

    it('switches the mount from the main checkout to the nested linked tree and mounts its git admin dirs', async () => {
      const { repo, tree } = await repoWithNestedTree()
      const fake = statefulEngine()
      const { run, sandbox } = await bindAt({ cwd: repo, engine: fake.engine })
      await run(repo)
      const first = fake.containers[0]?.id

      await sandbox.prepareWorkspace({ cwd: tree, threadId: THREAD })
      expect(fake.removals).toEqual([first ?? ''])

      await run(tree)
      const rebuilt = fake.containers[0]
      expect(rebuilt?.workingDir).toBe(tree)
      expect(rebuilt?.binds).toContain(`${tree}:${tree}`)
      expect(rebuilt?.binds).toContain(`${repo}/.git:${repo}/.git`)
      expect(rebuilt?.binds).not.toContain(`${repo}:${repo}`)
      expect(await Bun.file(join(repo, 'tracked.txt')).text()).toBe('main')
      expect(await Bun.file(join(tree, 'tracked.txt')).text()).toBe('main')
    })

    it('resolves the nested tree’s own container config', async () => {
      const { repo, tree } = await repoWithNestedTree()
      await mkdir(join(tree, '.atlas'), { recursive: true })
      await writeFile(
        join(tree, '.atlas', 'container.json'),
        JSON.stringify({ image: 'custom/nested:2', mounts: [{ path: SHARED }] }),
      )
      const fake = statefulEngine()
      const { sandbox, mounts, containerStatus } = await bindAt({ cwd: repo, engine: fake.engine })

      await sandbox.prepareWorkspace({ cwd: tree, threadId: THREAD })

      expect(mounts).toEqual([SHARED])
      expect(containerStatus.current().image).toBe('custom/nested:2')
    })

    it('keeps the anchor for a subdirectory of the same tree', async () => {
      const { repo } = await repoWithNestedTree()
      await mkdir(join(repo, 'packages', 'app'), { recursive: true })
      const fake = statefulEngine()
      const { run, sandbox } = await bindAt({ cwd: repo, engine: fake.engine })
      await run(repo)

      await sandbox.prepareWorkspace({ cwd: join(repo, 'packages', 'app'), threadId: THREAD })

      expect(fake.removals).toEqual([])
    })

    it('anchors a subdirectory of the nested tree at the nested tree’s root', async () => {
      const { repo, tree } = await repoWithNestedTree()
      await mkdir(join(tree, 'packages', 'app'), { recursive: true })
      const fake = statefulEngine()
      const { run, sandbox } = await bindAt({ cwd: repo, engine: fake.engine })
      await run(repo)

      await sandbox.prepareWorkspace({ cwd: join(tree, 'packages', 'app'), threadId: THREAD })
      await run(tree)

      expect(fake.containers[0]?.workingDir).toBe(tree)
    })
  })
})
