import type { ChangeBlobRow } from './change-content'
import type { ContextContentStore } from './context-content'

export const CONTEXT_FILES_GC_GRACE_MS = 7 * 24 * 60 * 60 * 1_000

export const CONTEXT_FILES_GC_ROW_LIMIT = 500

export type ContextFilesGcStore = {
  contextDigestsReferenced(params: { digests: readonly string[] }): Promise<ReadonlySet<string>>
  removeContextBytesIfUnreferenced(params: {
    digest: string
    content: ContextFilesGcContent
  }): Promise<boolean>
}

export type ContextFilesGcContent = Pick<ContextContentStore, 'list' | 'removing'>

export type ContextFilesGcParams = {
  store: ContextFilesGcStore
  content: ContextFilesGcContent
  graceMs?: number | undefined
}

export type ContextFilesGcSummary = {
  objectsDeleted: number
  failures: number
}

const pastGraceOf = (params: {
  objects: readonly ChangeBlobRow[]
  cutoff: number
}): readonly ChangeBlobRow[] =>
  params.objects
    .filter((object) => object.createdAt > 0 && object.createdAt < params.cutoff)
    .sort((left, right) => left.createdAt - right.createdAt)

const unreferencedOf = async (params: {
  store: ContextFilesGcStore
  objects: readonly ChangeBlobRow[]
  limit: number
}): Promise<readonly string[]> => {
  const unreferenced: string[] = []
  for (
    let start = 0;
    start < params.objects.length && unreferenced.length < params.limit;
    start += CONTEXT_FILES_GC_ROW_LIMIT
  ) {
    const page = params.objects.slice(start, start + CONTEXT_FILES_GC_ROW_LIMIT)
    const referenced = await params.store.contextDigestsReferenced({
      digests: page.map((object) => object.hash),
    })
    for (const object of page) {
      if (referenced.has(object.hash)) continue
      unreferenced.push(object.hash)
      if (unreferenced.length === params.limit) break
    }
  }
  return unreferenced
}

const removed = (outcome: boolean | undefined): boolean => outcome === true

export const runContextFilesGc = async (
  params: ContextFilesGcParams,
): Promise<ContextFilesGcSummary> => {
  const graceMs = params.graceMs ?? CONTEXT_FILES_GC_GRACE_MS
  const candidates = await unreferencedOf({
    store: params.store,
    objects: pastGraceOf({ objects: await params.content.list(), cutoff: Date.now() - graceMs }),
    limit: CONTEXT_FILES_GC_ROW_LIMIT,
  })
  const summary: ContextFilesGcSummary = { objectsDeleted: 0, failures: 0 }
  for (const digest of candidates) {
    const outcome = await params.store
      .removeContextBytesIfUnreferenced({ digest, content: params.content })
      .catch(() => undefined)
    if (removed(outcome)) {
      summary.objectsDeleted += 1
      continue
    }
    if (outcome !== false) summary.failures += 1
  }
  return summary
}
