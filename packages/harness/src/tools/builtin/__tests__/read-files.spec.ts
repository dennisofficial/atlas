import {
  decodeBase64,
  FileCapabilitiesPort,
  MAX_INLINE_BYTES,
  toThreadId,
} from '@dltech/atlas-core'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'bun:test'

import { ReadTool } from '../read'
import type { FileReadOutput } from '../read-file'

class NoFiles extends FileCapabilitiesPort {
  override acceptsFiles(): boolean {
    return false
  }
}

const pdf = (args: { padding?: number }): Uint8Array =>
  new Uint8Array([
    ...Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n'),
    ...Array.from({ length: args.padding ?? 0 }, (_, index) => index % 251),
  ])

let root = ''

const paths = { small: '', heavy: '', misnamed: '' }

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'atlas-read-files-'))

  paths.small = join(root, 'spec.pdf')
  paths.heavy = join(root, 'book.pdf')
  paths.misnamed = join(root, 'not-really.txt')

  await writeFile(paths.small, pdf({ padding: 64 * 1024 }))
  await writeFile(paths.heavy, pdf({ padding: MAX_INLINE_BYTES + 1 }))
  await writeFile(paths.misnamed, pdf({ padding: 128 }))
})

const tool = new ReadTool()

const read = async (path: string) =>
  await tool.invoke({
    input: { path },
    signal: new AbortController().signal,
    idempotencyKey: 'read-files',
    projectDirectory: '/workspace',
    threadId: toThreadId('thread-1'),
  })

const readWithoutFileSupport = async (path: string) =>
  await new ReadTool({ fileCapabilities: new NoFiles() }).invoke({
    input: { path },
    signal: new AbortController().signal,
    idempotencyKey: 'read-files',
    projectDirectory: '/workspace',
    threadId: toThreadId('thread-1'),
  })

const settled = async (path: string) => {
  const outcome = await read(path)
  if (!outcome.ok) throw new Error(outcome.reason)
  return outcome
}

describe('read on a PDF', () => {
  it('returns a text part naming the file and a file part carrying its bytes', async () => {
    const outcome = await settled(paths.small)

    expect(outcome.modelParts).toEqual([
      { type: 'text', text: `${paths.small} — application/pdf, 64 KB.` },
      {
        type: 'file',
        data: expect.any(String),
        mediaType: 'application/pdf',
        filename: 'spec.pdf',
        source: paths.small,
      },
    ])

    const part = outcome.modelParts?.[1]
    if (part === undefined || part.type !== 'file') throw new Error('expected a file part')
    expect(decodeBase64(part.data)[0]).toBe(0x25)
  })

  it('reports the file rather than refusing it as binary', async () => {
    const output = (await settled(paths.small)).output as FileReadOutput

    expect(output).toEqual({
      path: paths.small,
      mediaType: 'application/pdf',
      byteLength: 64 * 1024 + 69,
      inlined: true,
    })
  })

  it('names a PDF past the inline limit instead of sending it', async () => {
    const outcome = await settled(paths.heavy)

    expect(outcome.modelParts).toBeUndefined()
    expect(outcome.modelText).toContain('is past the 5.0 MB inline limit')
    expect((outcome.output as FileReadOutput).inlined).toBe(false)
  })

  it('sniffs the bytes rather than trusting the extension', async () => {
    const outcome = await settled(paths.misnamed)

    const part = outcome.modelParts?.[1]
    if (part === undefined || part.type !== 'file') throw new Error('expected a file part')
    expect(part.mediaType).toBe('application/pdf')
  })

  it('does not claim a whole-file reveal, so a file read cannot unlock an edit', async () => {
    const outcome = await settled(paths.small)

    expect(tool.revealsWholeFile?.({ input: { path: paths.small }, output: outcome.output })).toBe(
      false,
    )
  })

  it('refuses the file part when the active model cannot take one', async () => {
    const outcome = await readWithoutFileSupport(paths.small)

    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.reason).toContain('cannot read')
  })
})
