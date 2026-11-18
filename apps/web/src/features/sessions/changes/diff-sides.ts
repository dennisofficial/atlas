import type { DiffLine } from '@dltech/atlas-ui/ai/diff-viewer'

import { diffLines } from './line-diff'

export const WORKER_BYTES = 200_000

type Sides = { before: string; after: string }

function inWorker(args: Sides): Promise<DiffLine[]> {
  if (typeof Worker === 'undefined') return Promise.reject(new Error('this runtime has no workers'))
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./diff.worker.ts', import.meta.url))
    worker.onmessage = (event: MessageEvent<DiffLine[]>) => {
      worker.terminate()
      resolve(event.data)
    }
    worker.onerror = (event) => {
      worker.terminate()
      reject(new Error(event.message))
    }
    worker.postMessage(args)
  })
}

export const diffSides = (args: Sides): Promise<DiffLine[]> =>
  args.before.length > WORKER_BYTES || args.after.length > WORKER_BYTES
    ? inWorker(args).catch(() => diffLines(args))
    : Promise.resolve(diffLines(args))
