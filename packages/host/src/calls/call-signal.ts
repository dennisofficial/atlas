import type { Pending } from './remote-calls-frames'

const mayExistInPod = (call: Pending): boolean =>
  call.sent || call.replayed === true || call.attachOnly === true

export const attachCallSignal = (args: {
  call: Pending
  signal: AbortSignal
  isDetached(): boolean
  sendCancel(): void
  settleStopped(): void
}): void => {
  const onAbort = (): void => {
    if (args.isDetached()) return
    args.call.controller.abort()
    if (mayExistInPod(args.call)) args.sendCancel()
    args.settleStopped()
  }
  args.signal.addEventListener('abort', onAbort, { once: true })
  args.call.detach = () => args.signal.removeEventListener('abort', onAbort)
  if (args.signal.aborted) onAbort()
}

export const abandonCall = (args: {
  call: Pending
  pending: Map<string, Pending>
  error: Error
}): void => {
  if (args.call.done) return
  args.call.done = true
  args.pending.delete(args.call.key)
  args.call.detach?.()
  for (const waiter of args.call.waiters) waiter.reject?.(args.error)
}
