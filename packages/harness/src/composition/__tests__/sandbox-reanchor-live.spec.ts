import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, describe, expect, it } from 'bun:test'

import { ATLAS_SETTINGS, EExecutionLocation, ProcessPort, toThreadId } from '@dltech/atlas-core'
import { createHarnessContainer, createSettingsService, DockerEngine, MemorySettingsStore } from '@dltech/atlas-harness'

import { portToken } from '../../container/injection'
import { dockerUnavailableReason } from '../../execution/docker/__tests__/live-docker'
import { sessionLabel } from '../../execution/docker/sandbox'
import { recordingNotices } from './fakes'
import { createExecutionLocationState } from '../execution-location-state'
import { bindSandbox } from '../sandbox-binding'

const SOCKET = '/var/run/docker.sock'
const available = (await dockerUnavailableReason(SOCKET)) === undefined
const describeDocker = available ? describe : describe.skip

const engine = new DockerEngine({ socketPath: SOCKET })
const SESSION = `reanchor-live-${crypto.randomUUID()}`
const THREAD = toThreadId('reanchor-live-thread')
const directories: string[] = []

const fixture = async (marker: string): Promise<string> => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'atlas-reanchor-live-')))
  directories.push(directory)
  await writeFile(join(directory, 'marker.txt'), marker)
  return directory
}

afterAll(async () => {
  if (available) {
    const stale = await engine.listContainers({ labels: { [sessionLabel('atlas')]: SESSION }, all: true })
    for (const one of stale) await engine.removeContainer({ id: one.id })
  }
  await Promise.all(directories.map((one) => rm(one, { recursive: true, force: true })))
})

const outputOf = async (stream: ReadableStream<Uint8Array>): Promise<string> =>
  await new Response(stream).text()

describeDocker('re-anchoring a live sandbox', () => {
  it('runs in the container mounted at the restored tree, not the boot directory', async () => {
    const boot = await fixture('boot')
    const tree = await fixture('restored')
    const container = createHarnessContainer()
    const { sandbox } = await bindSandbox({
      container,
      engine,
      cwd: boot,
      sessionKey: () => SESSION,
      settings: createSettingsService({
        definitions: ATLAS_SETTINGS,
        user: new MemorySettingsStore({ label: 'reanchor live' }),
      }),
      executionLocation: createExecutionLocationState({ initial: EExecutionLocation.Docker }),
      notice: recordingNotices().port,
      atlasHome: join(boot, 'no-atlas-home'),
    })
    const processes = container.resolve(portToken(ProcessPort))
    const read = async (cwd: string, path: string): Promise<string> => {
      const handle = processes.spawn({ cmd: ['cat', path], cwd, threadId: THREAD })
      const [text] = await Promise.all([outputOf(handle.stdout), handle.exited])
      return text
    }

    expect(await read(boot, join(boot, 'marker.txt'))).toBe('boot')

    await sandbox.prepareWorkspace({ cwd: tree, threadId: THREAD })

    expect(await read(tree, join(tree, 'marker.txt'))).toBe('restored')
    expect(await Bun.file(join(boot, 'marker.txt')).text()).toBe('boot')
  }, 120_000)

  it('mounts a linked worktree nested under the booted checkout, with its git admin directory, and leaves the main checkout alone', async () => {
    const repo = await fixture('main')
    const git = (...args: string[]): void => {
      const run = Bun.spawnSync(
        ['git', '-c', 'user.name=atlas', '-c', 'user.email=atlas@example.com', ...args],
        { cwd: repo, stdout: 'ignore', stderr: 'pipe' },
      )
      if (!run.success) throw new Error(run.stderr.toString())
    }
    git('init', '-q', '-b', 'main')
    git('add', '.')
    git('commit', '-q', '-m', 'init')
    const tree = join(repo, '.atlas', 'worktrees', 'feature-4abc')
    git('worktree', 'add', '-q', tree, '-b', 'feature')
    await writeFile(join(tree, 'marker.txt'), 'nested')

    const container = createHarnessContainer()
    const { sandbox } = await bindSandbox({
      container,
      engine,
      cwd: repo,
      sessionKey: () => SESSION,
      settings: createSettingsService({
        definitions: ATLAS_SETTINGS,
        user: new MemorySettingsStore({ label: 'reanchor live nested' }),
      }),
      executionLocation: createExecutionLocationState({ initial: EExecutionLocation.Docker }),
      notice: recordingNotices().port,
      atlasHome: join(repo, 'no-atlas-home'),
    })
    const processes = container.resolve(portToken(ProcessPort))
    const run = async (cwd: string, cmd: string[]): Promise<string> => {
      const handle = processes.spawn({ cmd, cwd, threadId: THREAD })
      const [text] = await Promise.all([outputOf(handle.stdout), handle.exited])
      return text
    }

    expect(await run(repo, ['cat', join(repo, 'marker.txt')])).toBe('main')

    await sandbox.prepareWorkspace({ cwd: tree, threadId: THREAD })

    expect(await run(tree, ['cat', join(tree, 'marker.txt')])).toBe('nested')
    expect(await run(tree, ['git', 'rev-parse', '--show-toplevel'])).toContain(tree)
    expect(await Bun.file(join(repo, 'marker.txt')).text()).toBe('main')
  }, 120_000)
})
