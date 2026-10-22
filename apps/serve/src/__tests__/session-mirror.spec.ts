import { afterEach, describe, expect, it } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  EClientFrame,
  EClientRequest,
  EServeFrame,
  readSessionFilesReplySchema,
  sessionManifestReplySchema,
} from '@dltech/atlas-harness'

import {
  answerSessionMirrorRead,
  isSessionMirrorOp,
  type SessionMirrorRouting,
} from '../session-mirror-requests'
import { createSessionMirrorReader } from '../session-mirror'
import type { RequestFrame } from '../request-reply'

const homes: string[] = []

afterEach(async () => {
  await Promise.all(homes.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

const frameOf = (op: EClientRequest, params: unknown): RequestFrame => ({
  kind: EClientFrame.Request,
  id: 'req-1',
  op,
  params,
})

const sha256Of = (content: string): string => createHash('sha256').update(content).digest('hex')

async function fixture(
  files: Record<string, string>,
): Promise<{ routing: SessionMirrorRouting; revision: number }> {
  const sessionDir = await mkdtemp(join(tmpdir(), 'atlas-serve-mirror-'))
  homes.push(sessionDir)
  for (const [path, content] of Object.entries(files)) {
    await mkdir(join(sessionDir, path, '..'), { recursive: true })
    await writeFile(join(sessionDir, path), content)
  }
  const held = { revision: 3 }
  return {
    routing: {
      reader: createSessionMirrorReader({ sessionDir: () => sessionDir }),
      revision: () => held.revision,
    },
    revision: held.revision,
  }
}

describe('session-mirror ops', () => {
  it('classifies the two mirror ops', () => {
    expect(isSessionMirrorOp(EClientRequest.ReadSessionManifest)).toBe(true)
    expect(isSessionMirrorOp(EClientRequest.ReadSessionFiles)).toBe(true)
    expect(isSessionMirrorOp(EClientRequest.ReadEvents)).toBe(false)
  })

  it('answers the manifest with revision, sizes and hashes of every portable file', async () => {
    const { routing, revision } = await fixture({
      'meta.json': '{"format":1}',
      'threads/thr_1.meta.json': '{"id":"thr_1"}',
      'context/plan.md': '# plan\n',
      lock: 'pid 1',
    })

    const reply = await answerSessionMirrorRead({
      frame: frameOf(EClientRequest.ReadSessionManifest, {}),
      mirror: routing,
    })

    expect(reply.kind).toBe(EServeFrame.Reply)
    expect(reply.ok).toBe(true)
    const manifest = sessionManifestReplySchema.parse(reply.data)
    expect(manifest.revision).toBe(revision)
    expect(manifest.files).toEqual([
      { path: 'context/plan.md', bytes: 7, sha256: sha256Of('# plan\n') },
      { path: 'meta.json', bytes: 12, sha256: sha256Of('{"format":1}') },
      { path: 'threads/thr_1.meta.json', bytes: 14, sha256: sha256Of('{"id":"thr_1"}') },
    ])
    expect(manifest.files.some((file) => file.path === 'lock')).toBe(false)
  })

  it('answers read-session-files with utf8 contents and the missing paths', async () => {
    const { routing, revision } = await fixture({ 'context/plan.md': '# plan\n' })

    const reply = await answerSessionMirrorRead({
      frame: frameOf(EClientRequest.ReadSessionFiles, {
        paths: ['context/plan.md', 'context/gone.md'],
      }),
      mirror: routing,
    })

    expect(reply.ok).toBe(true)
    const answer = readSessionFilesReplySchema.parse(reply.data)
    expect(answer.revision).toBe(revision)
    expect(answer.files).toEqual([
      { path: 'context/plan.md', encoding: 'utf8', content: '# plan\n' },
    ])
    expect(answer.missing).toEqual(['context/gone.md'])
  })

  it('never follows a traversal path out of the session directory', async () => {
    const { routing } = await fixture({ 'meta.json': '{}' })

    const reply = await answerSessionMirrorRead({
      frame: frameOf(EClientRequest.ReadSessionFiles, { paths: ['../../etc/passwd', '..\\up'] }),
      mirror: routing,
    })

    const answer = readSessionFilesReplySchema.parse(reply.data)
    expect(answer.files).toEqual([])
    expect(answer.missing).toEqual(['../../etc/passwd', '..\\up'])
  })

  it('refuses a read without a paths list', async () => {
    const { routing } = await fixture({})

    const reply = await answerSessionMirrorRead({
      frame: frameOf(EClientRequest.ReadSessionFiles, {}),
      mirror: routing,
    })

    expect(reply.ok).toBe(false)
  })
})
