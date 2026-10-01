import { describe, expect, it } from 'bun:test'
import { join } from 'node:path'
import {
  buildSessionArchive,
  extractSessionArchive,
  readMetaSync,
  sessionDirectory,
  threadMetaFile,
  threadMetaSchema,
  writeMeta,
} from '@dltech/atlas-harness'
import { fakeServeApp } from './fakes'
import { scratchTranscriptStore } from './transcript-store-fixture'
import {
  askRestore,
  bootRestoreServe,
  freshRestoreHome,
  RESTORE_THREAD,
  restoreHomes,
  seedArchive,
  wireRealLog,
} from './restore-fixture'

const archiveWithModel = async (model: { ref: string; effort: string }): Promise<Uint8Array> => {
  const scratch = scratchTranscriptStore({ prefix: 'model-archive' })
  restoreHomes.push(scratch.home)
  const source = join(scratch.home, 'staged')
  await extractSessionArchive({ archive: await seedArchive({ texts: ['history'] }), sessionDir: source })
  const file = threadMetaFile({ sessionDir: source, threadId: RESTORE_THREAD })
  const meta = readMetaSync({ file, schema: threadMetaSchema })
  if (meta === undefined) throw new Error('missing source metadata')
  await writeMeta({ file, meta: { ...meta, modelRef: model.ref, modelEffort: model.effort } })
  const archive = await buildSessionArchive({ sessionDir: source })
  if (archive === undefined) throw new Error('missing archive')
  return archive
}

describe('model selection after an explicit archive replacement', () => {
  it('re-pins the running model, not only its on-disk metadata, on a retained serve', async () => {
    const before = { ref: 'anthropic/claude-sonnet-4-6', effort: 'high' }
    const after = { ref: 'openai/gpt-5.4', effort: 'medium' }
    let archive = await archiveWithModel(before)
    const revised = await archiveWithModel(after)
    const home = freshRestoreHome()
    const app = fakeServeApp({ threadId: RESTORE_THREAD, root: '/workspace' })
    wireRealLog({ home, app })
    let live = before
    app.modelBridge = {
      effort: () => live.effort,
      select: (model) => { live = model },
    }
    const find = app.threads.find.bind(app.threads)
    app.threads.find = async (request) => {
      const thread = await find(request)
      const meta = readMetaSync({
        file: threadMetaFile({ sessionDir: sessionDirectory({ home, sessionId: RESTORE_THREAD }), threadId: RESTORE_THREAD }),
        schema: threadMetaSchema,
      })
      if (thread === undefined || meta === undefined || meta.modelRef === null || meta.modelEffort === null) return thread
      return { ...thread, model: { ref: meta.modelRef, effort: meta.modelEffort } }
    }
    const { client } = await bootRestoreServe({ home, archive: async () => archive, app })
    archive = revised
    const result = await askRestore(client, 'restore-model')
    expect(result.ok).toBe(true)
    expect(live).toEqual(after)
  })
})
