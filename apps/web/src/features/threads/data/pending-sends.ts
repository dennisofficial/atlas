import { useSyncExternalStore } from 'react'

export type PendingSend = { sendId: string; text: string }

const pendings = new Map<string, PendingSend>()
const listeners = new Set<() => void>()

const emit = () => {
  for (const listener of listeners) listener()
}

export function setPendingSend(args: { threadId: string; sendId: string; text: string }): void {
  pendings.set(args.threadId, { sendId: args.sendId, text: args.text })
  emit()
}

export function clearPendingSend(threadId: string): void {
  if (pendings.delete(threadId)) emit()
}

export const pendingSendOf = (threadId: string): PendingSend | undefined => pendings.get(threadId)

export function subscribePendingSends(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function usePendingSend(threadId: string): PendingSend | undefined {
  return useSyncExternalStore(
    subscribePendingSends,
    () => pendingSendOf(threadId),
    () => undefined,
  )
}
