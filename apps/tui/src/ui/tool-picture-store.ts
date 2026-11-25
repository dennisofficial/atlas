import { createToolPictureLoader } from '@dltech/atlas-client/session'
import type { ToolPicture } from '@dltech/atlas-client/transcript'
import { useEffect, useSyncExternalStore } from 'react'

export type RemoteToolPicture = Extract<ToolPicture, { kind: 'media' | 'withheld' }>

export type ToolPictureSession = {
  sessionId: string
  mediaUrl(input: { sessionId: string; hash: string }): Promise<{ url: string }>
  toolPicture(input: {
    sessionId: string
    threadId: string
    seq: number
    part: number
  }): Promise<{ mediaType: string; data: string }>
}

type Held = {
  session: ToolPictureSession
  withheld: ReturnType<typeof createToolPictureLoader>
}

const listeners = new Set<() => void>()

const bytes = new Map<string, Uint8Array | null>()

const loading = new Set<string>()

let held: Held | undefined

let version = 0

const announce = (): void => {
  version += 1
  for (const listener of listeners) listener()
}

export const toolPictureKey = (picture: RemoteToolPicture): string =>
  picture.kind === 'media'
    ? `media:${picture.media.hash}`
    : `withheld:${picture.threadId}:${picture.seq}:${picture.part}`

export const subscribeToolPictures = (listener: () => void): (() => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export const toolPictureVersion = (): number => version

export const toolPictureBytes = (picture: RemoteToolPicture): Uint8Array | null | undefined =>
  bytes.get(toolPictureKey(picture))

const base64Of = (dataUrl: string): string => dataUrl.slice(dataUrl.indexOf(',') + 1)

const fetchBytes = async (args: {
  held: Held
  picture: RemoteToolPicture
}): Promise<Uint8Array> => {
  if (args.picture.kind === 'withheld') {
    const dataUrl = await args.held.withheld.dataUrlOf({
      ...args.picture,
      sessionId: args.held.session.sessionId,
    })
    return new Uint8Array(Buffer.from(base64Of(dataUrl), 'base64'))
  }
  const reply = await args.held.session.mediaUrl({
    sessionId: args.held.session.sessionId,
    hash: args.picture.media.hash,
  })
  const response = await fetch(reply.url)
  if (!response.ok) throw new Error(`picture fetch answered ${response.status}`)
  return new Uint8Array(await response.arrayBuffer())
}

export function requestToolPicture(picture: RemoteToolPicture): void {
  const key = toolPictureKey(picture)
  if (held === undefined || bytes.has(key) || loading.has(key)) return
  const active = held
  loading.add(key)
  void fetchBytes({ held: active, picture }).then(
    (loaded) => {
      loading.delete(key)
      bytes.set(key, loaded)
      announce()
    },
    () => {
      loading.delete(key)
      bytes.set(key, null)
      announce()
    },
  )
}

export function applyToolPictureSession(next: ToolPictureSession | undefined): void {
  if (next?.sessionId === held?.session.sessionId) return
  held =
    next === undefined
      ? undefined
      : {
          session: next,
          withheld: createToolPictureLoader({
            fetch: (input) => next.toolPicture(input),
          }),
        }
  bytes.clear()
  loading.clear()
  announce()
}

export function useToolPictureBytes(
  picture: RemoteToolPicture | undefined,
): Uint8Array | null | undefined {
  const current = useSyncExternalStore(subscribeToolPictures, toolPictureVersion)
  const key = picture === undefined ? undefined : toolPictureKey(picture)
  useEffect(() => {
    if (picture !== undefined) requestToolPicture(picture)
  }, [key, current])
  return picture === undefined ? undefined : toolPictureBytes(picture)
}
