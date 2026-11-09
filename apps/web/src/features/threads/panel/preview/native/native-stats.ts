import { ENativeEvent } from './webview-handle'

export type NativeStats = { navigations: number; ready: number; lastUrl: string | undefined }

const stats = new Map<string, NativeStats>()

const held = (key: string): NativeStats => {
  const existing = stats.get(key)
  if (existing !== undefined) return existing
  const created: NativeStats = { navigations: 0, ready: 0, lastUrl: undefined }
  stats.set(key, created)
  return created
}

export function noteNativeEvent(args: {
  key: string
  event: ENativeEvent
  url: string | undefined
}): void {
  const entry = held(args.key)
  if (args.event === ENativeEvent.DomReady) entry.ready += 1
  else entry.navigations += 1
  if (args.url !== undefined) entry.lastUrl = args.url
}

export const nativeStatsOf = (key: string): NativeStats => held(key)

export const forgetNativeStats = (key: string): void => void stats.delete(key)
