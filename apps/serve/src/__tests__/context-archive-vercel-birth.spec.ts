import { describe, expect, it } from 'bun:test'

import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { normalizeRepoOrigin, toThreadId, type NoticePort } from '@dltech/atlas-core'
import {
  captureContextArchive,
  CONTEXT_ARCHIVE_PATH,
  createLocalCloudBridge,
  ECloudSandboxState,
  memoryDirectoriesFor,
  type BridgeDriver,
  type LiveSandbox,
} from '@dltech/atlas-harness'
import type { SandboxPlacement, VercelSandboxConfig } from '@dltech/atlas-wire'

import { materializeContext } from '../materialize-context'
import { nodeWorkspaceFiles } from '../workspace-files'

const REMOTE_URL = 'git@github.com:comp-ai/atlas.git'

const config: VercelSandboxConfig = {
  credentials: { token: 'vt', teamId: 'team', projectId: 'proj' },
  image: 'atlas-sandbox:test',
}

const silentNotices: NoticePort = { notify: () => undefined }

const freshDirectory = (prefix: string): Promise<string> => mkdtemp(join(tmpdir(), prefix))

const put = async (args: { path: string; content: string }): Promise<void> => {
  await mkdir(dirname(args.path), { recursive: true })
  await writeFile(args.path, args.content, 'utf8')
}

const recordingDriver = () => {
  const events: string[] = []
  const writes: { path: string; content: Uint8Array | string }[] = []
  const liveSandbox = { runCommand: async () => ({ exitCode: 0 }) }
  const driver: BridgeDriver = {
    inspect: async () => undefined,
    createOrResume: async (createArgs) => {
      events.push('create')
      if (createArgs.putContextOnFreshBoot !== undefined) {
        await createArgs.putContextOnFreshBoot(liveSandbox as unknown as LiveSandbox)
      }
      events.push('launch')
      const placement: SandboxPlacement = {
        sessionId: 'session-1',
        url: 'https://sb.vercel.run',
        state: ECloudSandboxState.Running,
        created: true,
        token: 'tok',
      }
      return placement
    },
    writeBootstrapFileToSandbox: async (write) => {
      events.push(`write:${write.path}`)
      writes.push({ path: write.path, content: write.content })
    },
    writeBootstrapFile: async () => {},
    readResources: async () => ({}),
    updateResources: async () => {},
    destroy: async () => {},
  }
  return { driver, events, writes }
}

describe('the Vercel birth path carries the user layer', () => {
  it('births with the captured archive written before launch, and a sandbox restores it byte for byte', async () => {
    const home = await freshDirectory('atlas-birth-home-')
    const atlasHome = await freshDirectory('atlas-birth-atlashome-')
    const projectDirectory = await freshDirectory('atlas-birth-project-')
    await put({ path: join(atlasHome, 'skills', 'demo', 'SKILL.md'), content: '# demo skill' })
    await put({ path: join(atlasHome, 'ATLAS.md'), content: '# global instructions' })
    await put({ path: join(atlasHome, 'mcp.json'), content: '{"servers":{}}' })
    await put({ path: join(atlasHome, 'memory', 'MEMORY.md'), content: '# user memory' })
    const hostProjectMemory = memoryDirectoriesFor({ atlasHome, repoRoot: projectDirectory }).project
    await put({ path: join(hostProjectMemory, 'notes.md'), content: '# project notes' })
    await put({ path: join(projectDirectory, 'CLAUDE.local.md'), content: '# local rules' })

    const { driver, events, writes } = recordingDriver()
    const bridge = createLocalCloudBridge({
      vercel: () => config,
      attachmentToken: () => 'tok',
      driverWith: () => driver,
    })
    const archive = await captureContextArchive({
      home,
      atlasHome,
      projectDirectory,
      notice: silentNotices,
    })
    if (archive === undefined) throw new Error('expected an archive')

    await bridge.sandboxes.create({
      threadId: toThreadId('thread-user-layer'),
      workspace: { remoteUrl: REMOTE_URL },
      captureContext: async (putArchive) => putArchive(archive),
    })

    const archiveWrite = writes.find((entry) => entry.path === CONTEXT_ARCHIVE_PATH)
    expect(archiveWrite).toBeDefined()
    expect(events.indexOf(`write:${CONTEXT_ARCHIVE_PATH}`)).toBeLessThan(events.indexOf('launch'))

    const recorded = archiveWrite?.content
    if (!(recorded instanceof Uint8Array)) throw new Error('expected the archive bytes')
    const sandboxAtlasHome = await freshDirectory('atlas-birth-sandbox-home-')
    const sandboxProject = await freshDirectory('atlas-birth-sandbox-project-')
    const readiness = await materializeContext({
      fetchSpec: async () => ({ remoteUrl: REMOTE_URL, githubToken: null }),
      fetchArchive: async () => recorded,
      atlasHome: sandboxAtlasHome,
      projectDirectory: sandboxProject,
      files: nodeWorkspaceFiles,
    })

    const sandboxProjectMemory = memoryDirectoriesFor({
      atlasHome: sandboxAtlasHome,
      repoRoot: sandboxProject,
      identity: normalizeRepoOrigin(REMOTE_URL),
    }).project
    expect(readiness.failed).toBeNull()
    expect(await readFile(join(sandboxAtlasHome, 'skills', 'demo', 'SKILL.md'), 'utf8')).toBe('# demo skill')
    expect(await readFile(join(sandboxAtlasHome, 'ATLAS.md'), 'utf8')).toBe('# global instructions')
    expect(await readFile(join(sandboxAtlasHome, 'mcp.json'), 'utf8')).toBe('{"servers":{}}')
    expect(await readFile(join(sandboxAtlasHome, 'memory', 'MEMORY.md'), 'utf8')).toBe('# user memory')
    expect(await readFile(join(sandboxProjectMemory, 'notes.md'), 'utf8')).toBe('# project notes')
    expect(await readFile(join(sandboxProject, 'CLAUDE.local.md'), 'utf8')).toBe('# local rules')
  })
})
