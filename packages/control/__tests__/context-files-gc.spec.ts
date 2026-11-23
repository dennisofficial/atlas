import { expect, it } from 'bun:test'

import { EContextFileKind } from '@dltech/atlas-core'

import {
  CONTEXT_FILES_GC_GRACE_MS,
  CONTEXT_FILES_GC_ROW_LIMIT,
  type ContextFilesGcStore,
  runContextFilesGc,
} from '../src/context-files-gc'
import { ControlPlane } from '../src/control-plane'
import { InMemoryControlStore } from '../src/testing/memory'
import { FakeContextContentStore } from '../src/testing'

const DAY_MS = 24 * 60 * 60 * 1_000
const SESSION = 'session-1'

const hashOf = (seed: string): string => seed.repeat(64).slice(0, 64)

const digestOf = (index: number): string => index.toString(16).padStart(64, '0')

const REFERENCED = hashOf('a')
const ORPHAN = hashOf('b')
const YOUNG = hashOf('c')

const planeOf = (): ControlPlane => new ControlPlane({ store: new InMemoryControlStore() })

const seedReferenced = async (params: { plane: ControlPlane; digest: string }): Promise<void> => {
  const plane = params.plane
  await plane.createSession({
    sessionId: SESSION,
    userId: 'user-1',
    projectId: 'project-1',
    mainThreadId: 'thread-1',
  })
  await plane.upsertContextFiles({
    sessionId: SESSION,
    files: [
      {
        path: 'briefs/plan.md',
        digest: params.digest,
        size: 4,
        mime: 'text/markdown',
        kind: EContextFileKind.Text,
        mtimeMs: 0,
      },
    ],
  })
}

const seedRows = async (params: {
  plane: ControlPlane
  digests: readonly string[]
}): Promise<void> => {
  await params.plane.createSession({
    sessionId: SESSION,
    userId: 'user-1',
    projectId: 'project-1',
    mainThreadId: 'thread-1',
  })
  await params.plane.upsertContextFiles({
    sessionId: SESSION,
    files: params.digests.map((digest, index) => ({
      path: `briefs/${index}.md`,
      digest,
      size: 1,
      mime: 'text/markdown',
      kind: EContextFileKind.Text,
      mtimeMs: 0,
    })),
  })
}

const agedContent = (ageMs: number): FakeContextContentStore => {
  const at = Date.now() - ageMs
  return new FakeContextContentStore({ clock: () => at })
}

class RecordingContent extends FakeContextContentStore {
  readonly events: string[] = []

  override removing(hashes: readonly string[]): Promise<void> {
    this.events.push('objects')
    return super.removing(hashes)
  }
}

class FailingContent extends FakeContextContentStore {
  override removing(): Promise<void> {
    return Promise.reject(new Error('context storage refused the delete'))
  }
}

const recordingStore = (inner: ControlPlane, events: string[]): ContextFilesGcStore => ({
  contextDigestsReferenced: async (params) => {
    events.push('rows')
    return inner.contextDigestsReferenced(params)
  },
  removeContextBytesIfUnreferenced: async (params) => {
    events.push('removing')
    return inner.removeContextBytesIfUnreferenced(params)
  },
})

it('keeps content an index row still references', async () => {
  const plane = planeOf()
  await seedReferenced({ plane, digest: REFERENCED })
  const content = agedContent(8 * DAY_MS)
  await content.put({ hash: REFERENCED, bytes: new Uint8Array([1, 2, 3, 4]) })

  expect(await runContextFilesGc({ store: plane, content })).toEqual({
    objectsDeleted: 0,
    failures: 0,
  })
  expect(await content.read({ hash: REFERENCED })).not.toBeNull()
})

it('keeps unreferenced content younger than the grace', async () => {
  const content = agedContent(0)
  await content.put({ hash: ORPHAN, bytes: new Uint8Array([5, 6, 7]) })

  expect(await runContextFilesGc({ store: planeOf(), content })).toEqual({
    objectsDeleted: 0,
    failures: 0,
  })
  expect(await content.read({ hash: ORPHAN })).not.toBeNull()
})

it('deletes unreferenced content past the grace and is safe to re-run', async () => {
  const content = new RecordingContent({ clock: () => Date.now() - 8 * DAY_MS })
  await content.put({ hash: ORPHAN, bytes: new Uint8Array([5, 6, 7]) })
  const events: string[] = []

  expect(await runContextFilesGc({ store: recordingStore(planeOf(), events), content })).toEqual({
    objectsDeleted: 1,
    failures: 0,
  })
  expect(events).toEqual(['rows', 'removing'])
  expect(content.events).toEqual(['objects'])
  expect(await content.read({ hash: ORPHAN })).toBeNull()
  expect(await runContextFilesGc({ store: planeOf(), content })).toEqual({
    objectsDeleted: 0,
    failures: 0,
  })
})

it('counts a failed delete instead of throwing, and leaves the object in place', async () => {
  const content = new FailingContent({ clock: () => Date.now() - 8 * DAY_MS })
  await content.put({ hash: ORPHAN, bytes: new Uint8Array([5, 6, 7]) })

  expect(await runContextFilesGc({ store: planeOf(), content })).toEqual({
    objectsDeleted: 0,
    failures: 1,
  })
  expect(await content.read({ hash: ORPHAN })).not.toBeNull()
})

it('deletes only the objects past the grace', async () => {
  let at = Date.now() - 8 * DAY_MS
  const content = new FakeContextContentStore({ clock: () => at })
  await content.put({ hash: ORPHAN, bytes: new Uint8Array([8]) })
  at = Date.now()
  await content.put({ hash: YOUNG, bytes: new Uint8Array([9]) })

  expect(await runContextFilesGc({ store: planeOf(), content })).toEqual({
    objectsDeleted: 1,
    failures: 0,
  })
  expect(await content.read({ hash: ORPHAN })).toBeNull()
  expect(await content.read({ hash: YOUNG })).not.toBeNull()
})

it('deletes an orphan that sits behind a full page of referenced objects', async () => {
  const plane = planeOf()
  const referenced = Array.from({ length: CONTEXT_FILES_GC_ROW_LIMIT }, (_value, index) =>
    digestOf(index),
  )
  await seedRows({ plane, digests: referenced })
  const content = agedContent(8 * DAY_MS)
  for (const digest of referenced) {
    await content.put({ hash: digest, bytes: new Uint8Array([1]) })
  }
  await content.put({ hash: ORPHAN, bytes: new Uint8Array([2]) })

  expect(await runContextFilesGc({ store: plane, content })).toEqual({
    objectsDeleted: 1,
    failures: 0,
  })
  expect(await content.read({ hash: ORPHAN })).toBeNull()
  expect(await content.read({ hash: referenced[0] ?? '' })).not.toBeNull()
})

it('keeps the bytes when a row claims the digest before the delete', async () => {
  const plane = planeOf()
  const content = agedContent(8 * DAY_MS)
  await content.put({ hash: ORPHAN, bytes: new Uint8Array([5, 6, 7]) })
  let raced = false
  const store: ContextFilesGcStore = {
    contextDigestsReferenced: (params) => plane.contextDigestsReferenced(params),
    removeContextBytesIfUnreferenced: async (params) => {
      if (!raced) {
        raced = true
        await seedReferenced({ plane, digest: ORPHAN })
      }
      return plane.removeContextBytesIfUnreferenced(params)
    },
  }

  expect(await runContextFilesGc({ store, content })).toEqual({
    objectsDeleted: 0,
    failures: 0,
  })
  expect(await content.read({ hash: ORPHAN })).not.toBeNull()
})

it('keeps unreferenced content for a week by default', () => {
  expect(CONTEXT_FILES_GC_GRACE_MS).toBe(7 * DAY_MS)
  expect(CONTEXT_FILES_GC_ROW_LIMIT).toBe(500)
})
