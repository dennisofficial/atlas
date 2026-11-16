import { describe, expect, it } from 'bun:test'
import { existsSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { toThreadId, type ToolOutcome } from '@dltech/atlas-core'

import { LocalFileSystemPort } from '../../../execution/local-filesystem'
import { LocalProcessPort } from '../../../execution/local-process'
import { PushArtifactTool } from '../artifact-push'

import { FakeArtifactPort } from './artifact-fakes'

const processes = new LocalProcessPort()
const files = new LocalFileSystemPort()

const withDir = async (run: (dir: string) => Promise<void>): Promise<void> => {
  const dir = await mkdtemp(join(tmpdir(), 'atlas-artifact-push-'))
  try {
    await run(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

const rigOf = (dir: string) => {
  const port = new FakeArtifactPort()
  const tool = new PushArtifactTool({
    port,
    processes,
    files,
    fetchFn: async () => ({ ok: true, status: 200 }),
  })
  return { port, tool }
}

const push = async (args: { dir: string; tool: PushArtifactTool }): Promise<ToolOutcome> =>
  await args.tool.invoke({
    input: {},
    signal: new AbortController().signal,
    idempotencyKey: 'k',
    projectDirectory: args.dir,
    threadId: toThreadId('thr_1'),
  } as never)

const initRepo = async (dir: string): Promise<void> => {
  const handle = processes.spawn({ cmd: ['git', '-C', dir, 'init', '-q'], cwd: dir })
  await Promise.all([new Response(handle.stdout).text(), new Response(handle.stderr).text()])
  expect(await handle.exited).toBe(0)
}

const pathsOf = (port: FakeArtifactPort): string[] =>
  (port.beginCalls[0]?.entries ?? []).map((entry) => entry.path).sort()

describe('artifact_push into a folder git does not track', () => {
  it('initialises git in a fresh folder so the push can list its files', async () => {
    await withDir(async (dir) => {
      await writeFile(join(dir, 'index.html'), '<h1>hi</h1>')
      await writeFile(join(dir, '.gitignore'), 'secret.txt\n')
      await writeFile(join(dir, 'secret.txt'), 'hidden')
      const rig = rigOf(dir)

      const outcome = await push({ dir, tool: rig.tool })

      expect(existsSync(join(dir, '.git'))).toBe(true)
      expect(pathsOf(rig.port)).toEqual(['.gitignore', 'index.html'])
      if (!outcome.ok) throw new Error(outcome.reason)
      expect(outcome.modelText).toContain(
        `Initialised git in ${dir} so the push could list its files.`,
      )
    })
  })

  it('does not initialise git again on the second push of the same folder', async () => {
    await withDir(async (dir) => {
      await writeFile(join(dir, 'index.html'), '<h1>hi</h1>')
      const rig = rigOf(dir)
      const first = await push({ dir, tool: rig.tool })
      if (!first.ok) throw new Error(first.reason)

      const second = await push({ dir, tool: rig.tool })

      if (!second.ok) throw new Error(second.reason)
      expect(first.modelText).toContain('Initialised git in')
      expect(second.modelText).not.toContain('Initialised git')
    })
  })

  it('leaves a folder that is already inside a worktree alone', async () => {
    await withDir(async (dir) => {
      await initRepo(dir)
      await writeFile(join(dir, 'index.html'), '<h1>hi</h1>')
      const rig = rigOf(dir)

      const outcome = await push({ dir, tool: rig.tool })

      if (!outcome.ok) throw new Error(outcome.reason)
      expect(outcome.modelText).not.toContain('Initialised git')
      expect(pathsOf(rig.port)).toEqual(['index.html'])
    })
  })
})
