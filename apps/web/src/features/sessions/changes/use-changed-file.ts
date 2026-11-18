'use client'

import type { DiffLine } from '@dltech/atlas-ui/ai/diff-viewer'
import type { ChangedFile as ChangedFileEntry } from '@dltech/atlas-protocol'
import { EChangeSide } from '@dltech/atlas-protocol'
import { useEffect, useState } from 'react'

import { fetchChangeContent } from './changes-api'
import { diffSides } from './diff-sides'

export const CACHE_LIMIT = 20

const sides = new Map<string, Promise<Uint8Array>>()
const diffs = new Map<string, Promise<DiffLine[]>>()

export const resetChangeCaches = (): void => {
  sides.clear()
  diffs.clear()
}

function remember<T>(cache: Map<string, T>, key: string, value: T): void {
  cache.delete(key)
  cache.set(key, value)
  for (const oldest of cache.keys()) {
    if (cache.size <= CACHE_LIMIT) return
    cache.delete(oldest)
  }
}

export const diffKeyOf = (file: ChangedFileEntry): string =>
  `${file.baseHash ?? '-'}:${file.currentHash ?? '-'}`

export const hasDiffOf = (file: ChangedFileEntry): boolean =>
  !file.binary && (file.baseHash !== null || file.currentHash !== null)

type SideArgs = {
  sessionId: string
  checkoutId: string
  path: string
  hash: string
  side: EChangeSide
}

function bytesOf(args: SideArgs): Promise<Uint8Array> {
  const cached = sides.get(args.hash)
  if (cached !== undefined) {
    remember(sides, args.hash, cached)
    return cached
  }
  const promise = fetchChangeContent({
    sessionId: args.sessionId,
    checkoutId: args.checkoutId,
    path: args.path,
    side: args.side,
  }).then(async (signed) => {
    const response = await fetch(signed.url)
    if (!response.ok) throw new Error(`the change content answered ${response.status}`)
    return new Uint8Array(await response.arrayBuffer())
  })
  remember(sides, args.hash, promise)
  void promise.catch(() => {
    if (sides.get(args.hash) === promise) sides.delete(args.hash)
  })
  return promise
}

const textOf = (bytes: Uint8Array | null): string =>
  bytes === null ? '' : new TextDecoder().decode(bytes)

const sideOf = (args: {
  sessionId: string
  checkoutId: string
  path: string
  hash: string | null
  side: EChangeSide
}): Promise<Uint8Array | null> =>
  args.hash === null
    ? Promise.resolve(null)
    : bytesOf({
        sessionId: args.sessionId,
        checkoutId: args.checkoutId,
        path: args.path,
        hash: args.hash,
        side: args.side,
      })

export function loadDiff(args: {
  sessionId: string
  checkoutId: string
  file: ChangedFileEntry
}): Promise<DiffLine[]> {
  const key = diffKeyOf(args.file)
  const cached = diffs.get(key)
  if (cached !== undefined) {
    remember(diffs, key, cached)
    return cached
  }
  const promise = Promise.all([
    sideOf({
      sessionId: args.sessionId,
      checkoutId: args.checkoutId,
      path: args.file.path,
      hash: args.file.baseHash,
      side: EChangeSide.Base,
    }),
    sideOf({
      sessionId: args.sessionId,
      checkoutId: args.checkoutId,
      path: args.file.path,
      hash: args.file.currentHash,
      side: EChangeSide.Current,
    }),
  ]).then(([base, current]) => diffSides({ before: textOf(base), after: textOf(current) }))
  remember(diffs, key, promise)
  void promise.catch(() => {
    if (diffs.get(key) === promise) diffs.delete(key)
  })
  return promise
}

export type ChangedFileState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; lines: DiffLine[] }
  | { status: 'failed'; message: string }

const messageOf = (failure: unknown): string =>
  failure instanceof Error ? failure.message : 'the diff could not be loaded'

export function useChangedFile(args: {
  sessionId: string
  checkoutId: string
  file: ChangedFileEntry
}): ChangedFileState {
  const key = diffKeyOf(args.file)
  const [state, setState] = useState<ChangedFileState>({ status: 'idle' })
  const loadable = hasDiffOf(args.file)
  useEffect(() => {
    if (!loadable) {
      setState({ status: 'idle' })
      return
    }
    let live = true
    setState({ status: 'loading' })
    void loadDiff({
      sessionId: args.sessionId,
      checkoutId: args.checkoutId,
      file: args.file,
    }).then(
      (lines) => {
        if (live) setState({ status: 'ready', lines })
      },
      (failure: unknown) => {
        if (live) setState({ status: 'failed', message: messageOf(failure) })
      },
    )
    return () => {
      live = false
    }
  }, [args.sessionId, args.checkoutId, key, loadable])
  return state
}
