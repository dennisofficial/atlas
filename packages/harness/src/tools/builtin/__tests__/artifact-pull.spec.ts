import { describe, expect, it } from 'bun:test'

import { toThreadId, type ToolDefinition, type ToolOutcome } from '@dltech/atlas-core'

import { ArtifactUnavailable } from '../../../artifacts/artifact-port'
import { PullArtifactTool } from '../artifact-pull'

import { FakeArtifactPort, FakeFiles } from './artifact-fakes'

const PNG_BYTES = new Uint8Array([0x00, 0xff, 0x89, 0x50, 0x4e, 0x47])

const contents: Record<string, string> = {
  'https://download.test/src/main.ts': 'export const main = () => 1\n',
  'https://download.test/package.json': '{ "name": "demo" }\n',
}

const binaryContents: Record<string, Uint8Array<ArrayBuffer>> = {
  'https://download.test/logo.png': PNG_BYTES,
}

const rigOf = () => {
  const port = new FakeArtifactPort()
  const files = new FakeFiles()
  const requested: string[] = []
  port.sourceEntries = [
    { path: 'src/main.ts', url: 'https://download.test/src/main.ts' },
    { path: 'package.json', url: 'https://download.test/package.json' },
  ]
  const fetchFn = (async (input: string | URL | Request) => {
    const url = String(input)
    requested.push(url)
    const body = contents[url] ?? binaryContents[url]
    return new Response(body ?? 'missing', { status: body === undefined ? 404 : 200 })
  }) as unknown as typeof fetch
  const tool = new PullArtifactTool({ port, files, fetchFn })
  return { port, files, requested, tool }
}

const invoke = async (input: Record<string, unknown>, tool: ToolDefinition) =>
  await tool.invoke({
    input,
    signal: new AbortController().signal,
    idempotencyKey: 'k',
    projectDirectory: '/ws',
    threadId: toThreadId('thr_1'),
  } as never)

const reasonOf = (outcome: ToolOutcome): string => (outcome.ok ? '' : outcome.reason)

describe('artifact_pull', () => {
  it('refuses a target directory that already holds files', async () => {
    const rig = rigOf()
    rig.files.put('/ws/out/existing.txt', 'mine')

    const outcome = await invoke({ slug: 'demo', dir: 'out' }, rig.tool)

    expect(outcome.ok).toBe(false)
    expect(reasonOf(outcome)).toContain('not empty')
    expect(rig.requested).toHaveLength(0)
    expect(rig.files.text('/ws/out/package.json')).toBeUndefined()
  })

  it('writes every file through the filesystem port when forced', async () => {
    const rig = rigOf()
    rig.files.put('/ws/out/existing.txt', 'mine')

    const outcome = await invoke({ slug: 'demo', dir: 'out', force: true }, rig.tool)

    expect(outcome.ok).toBe(true)
    expect(rig.files.text('/ws/out/src/main.ts')).toBe(
      contents['https://download.test/src/main.ts'],
    )
    expect(rig.files.text('/ws/out/package.json')).toBe(
      contents['https://download.test/package.json'],
    )
    expect(rig.files.directories.has('/ws/out/src')).toBe(true)
  })

  it('restores into an empty directory and says a build step may follow', async () => {
    const rig = rigOf()

    const outcome = await invoke({ slug: 'demo', dir: 'out' }, rig.tool)

    expect(outcome.ok).toBe(true)
    expect(outcome.ok ? outcome.modelText : '').toContain('bun install')
    expect(rig.files.text('/ws/out/package.json')).toBe(
      contents['https://download.test/package.json'],
    )
  })

  it('restores bytes that are not UTF-8 text unchanged', async () => {
    const rig = rigOf()
    rig.port.sourceEntries = [{ path: 'assets/logo.png', url: 'https://download.test/logo.png' }]

    const outcome = await invoke({ slug: 'demo', dir: 'out' }, rig.tool)

    expect(outcome.ok).toBe(true)
    expect(await rig.files.readBytes({ path: '/ws/out/assets/logo.png' })).toEqual(PNG_BYTES)
  })

  it('turns a port error into prose rather than throwing', async () => {
    const rig = rigOf()
    rig.port.failure = new ArtifactUnavailable('sign in to Atlas Cloud to pull artifacts')

    const outcome = await invoke({ slug: 'demo', dir: 'out' }, rig.tool)

    expect(outcome.ok).toBe(false)
    expect(reasonOf(outcome)).toContain('sign in to Atlas Cloud')
  })
})
