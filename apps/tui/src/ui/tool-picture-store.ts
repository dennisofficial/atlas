import type { ToolPicture } from '@dltech/atlas-client/transcript'
import { useEffect, useSyncExternalStore } from 'react'

export type RemoteToolPicture = ToolPicture

export type ToolPictureSession = {
  sessionId: string
  mediaUrl(input: { sessionId: string; hash: string }): Promise<{ url: string }>
}

const listeners = new Set<() => void>()

const bytes = new Map<string, Uint8Array | null>()

const loading = new Set<string>()

let held: ToolPictureSession | undefined

let version = 0

const announce = (): void => {
  version += 1
  for (const listener of listeners) listener()
}

export const toolPictureKey = (picture: RemoteToolPicture): string => `media:${picture.media.hash}`

export const subscribeToolPictures = (listener: () => void): (() => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export const toolPictureVersion = (): number => version

export const toolPictureBytes = (picture: RemoteToolPicture): Uint8Array | null | undefined =>
  bytes.get(toolPictureKey(picture))

const fetchBytes = async (args: {
  session: ToolPictureSession
  picture: RemoteToolPicture
}): Promise<Uint8Array> => {
  const reply = await args.session.mediaUrl({
    sessionId: args.session.sessionId,
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
  void fetchBytes({ session: active, picture }).then(
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
  if (next?.sessionId === held?.sessionId) return
  held = next
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
