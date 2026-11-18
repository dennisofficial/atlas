import type { DiffLine } from '@dltech/atlas-ui/ai/diff-viewer'

import { diffLines } from './line-diff'

type WorkerScope = {
  onmessage: ((event: MessageEvent<{ before: string; after: string }>) => void) | null
  postMessage: (lines: DiffLine[]) => void
}

const scope = globalThis as unknown as WorkerScope

scope.onmessage = (event) => {
  scope.postMessage(diffLines(event.data))
}
