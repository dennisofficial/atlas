import type { CodeLineMark } from '@dltech/atlas-ui/ai/code-viewer'
import type { DiffLine } from '@dltech/atlas-ui/ai/diff-viewer'

export function lineMarksOf(lines: readonly DiffLine[]): Map<number, CodeLineMark> {
  const marks = new Map<number, CodeLineMark>()
  let removed = 0
  let lastNew = 0
  const flushTrailing = () => {
    if (removed > 0) marks.set(lastNew + 1, 'deleted-above')
    removed = 0
  }
  for (const line of lines) {
    if (line.kind === 'gap') {
      flushTrailing()
      continue
    }
    if (line.kind === 'remove') {
      removed += 1
      continue
    }
    if (line.newNumber === undefined) continue
    lastNew = line.newNumber
    if (line.kind === 'add') {
      marks.set(line.newNumber, removed > 0 ? 'modified' : 'added')
      removed = Math.max(0, removed - 1)
      continue
    }
    if (removed > 0) marks.set(line.newNumber, 'deleted-above')
    removed = 0
  }
  flushTrailing()
  return marks
}
