import { FRAME_MS } from './reveal'

export type RepaintTimers = {
  scheduleFrame(onFrame: () => void): void
  scheduleRepaint(): void
  cancelRepaint(): void
  dispose(): void
}

export function createRepaintTimers(args: { republish: () => void }): RepaintTimers {
  let frame: ReturnType<typeof setTimeout> | undefined
  let queuedRepaint: ReturnType<typeof setTimeout> | undefined

  const cancelRepaint = () => {
    if (queuedRepaint !== undefined) clearTimeout(queuedRepaint)
    queuedRepaint = undefined
  }

  return {
    scheduleFrame(onFrame) {
      if (frame !== undefined) return
      frame = setTimeout(() => {
        frame = undefined
        onFrame()
      }, FRAME_MS)
    },

    scheduleRepaint() {
      if (queuedRepaint !== undefined) return
      queuedRepaint = setTimeout(() => {
        queuedRepaint = undefined
        args.republish()
      }, FRAME_MS)
    },

    cancelRepaint,

    dispose() {
      if (frame !== undefined) clearTimeout(frame)
      frame = undefined
      cancelRepaint()
    },
  }
}
