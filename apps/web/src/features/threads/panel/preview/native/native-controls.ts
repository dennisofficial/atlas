import type { FrameDriver } from './frame-driver'
import type { NativeWebview } from './webview-handle'

export type NativeHandle = { webview: NativeWebview; driver: FrameDriver }

const handles = new Map<string, NativeHandle>()

export function registerNative(args: { key: string; handle: NativeHandle }): () => void {
  const { key, handle } = args
  handles.set(key, handle)
  return () => {
    if (handles.get(key) !== handle) return
    handles.delete(key)
  }
}

export const nativeOf = (key: string): NativeHandle | undefined => handles.get(key)
