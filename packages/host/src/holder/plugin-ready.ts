import type { ComposedPod, DaemonReady, PluginPodContext } from '@dltech/atlas-plugin-sdk'

import type { SessionRuntime } from './ports'

export const watchDaemonReady = (args: {
  onReady: SessionRuntime['remoteCalls']['onReady']
  bootId: () => string | undefined
  pod: Pick<ComposedPod, 'onDaemonReady'>
  ctx: PluginPodContext
  signal: AbortSignal
}): void => {
  let announced: string | undefined
  const announce = (hello: DaemonReady): void => {
    if (hello.bootId === announced) return
    announced = hello.bootId
    args.pod.onDaemonReady({ ctx: args.ctx, hello })
  }
  const offReady = args.onReady(announce)
  args.signal.addEventListener('abort', offReady, { once: true })
  const booted = args.bootId()
  if (booted !== undefined) announce({ bootId: booted, restart: false })
}
