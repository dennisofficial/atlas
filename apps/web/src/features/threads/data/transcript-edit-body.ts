import { dictatedContentOf, diffOf, type ToolCall } from '@dltech/atlas-client/transcript'
import { collapseUnchanged, EDiffLine, type DiffLine as CoreDiffLine } from '@dltech/atlas-core'
import type { DiffLine } from '@dltech/atlas-ui/ai/diff-viewer'
import { EToolState } from '@dltech/atlas-ui/ai/tool'

const BODY_LINES = 20
const DIFF_CONTEXT = 3

export enum EEditBody {
  Diff = 'diff',
  Content = 'content',
}

export type EditBody =
  | { kind: EEditBody.Diff; added: number; removed: number; lines: DiffLine[] }
  | { kind: EEditBody.Content; text: string; firstLine: number; total: number }

const VIEWER_LINE: Record<EDiffLine, DiffLine['kind']> = {
  [EDiffLine.Context]: 'context',
  [EDiffLine.Added]: 'add',
  [EDiffLine.Removed]: 'remove',
  [EDiffLine.Elision]: 'gap',
}

function viewerLineOf(line: CoreDiffLine): DiffLine {
  const kind = VIEWER_LINE[line.kind]
  if (kind === 'gap') {
    const elided = line.elided ?? 0
    return {
      kind,
      text: `${elided} unchanged ${elided === 1 ? 'line' : 'lines'}`,
    }
  }
  return {
    kind,
    text: line.text,
    ...(line.oldNumber === null ? {} : { oldNumber: line.oldNumber }),
    ...(line.newNumber === null ? {} : { newNumber: line.newNumber }),
  }
}

function contentBodyOf(args: { text: string; running: boolean }): EditBody {
  const all = args.text.replace(/\n$/, '').split('\n')
  const shown = args.running ? all.slice(-BODY_LINES) : all.slice(0, BODY_LINES)
  return {
    kind: EEditBody.Content,
    text: shown.join('\n'),
    firstLine: args.running ? all.length - shown.length + 1 : 1,
    total: all.length,
  }
}

export function editBodyOf(args: { call: ToolCall; state: EToolState }): EditBody | undefined {
  const { call, state } = args
  const diff = state === EToolState.Done ? diffOf(call) : null
  if (diff !== null) {
    return {
      kind: EEditBody.Diff,
      added: diff.added,
      removed: diff.removed,
      lines: diff.hunks.flatMap((hunk) =>
        collapseUnchanged({ hunk, context: DIFF_CONTEXT }).lines.map(viewerLineOf),
      ),
    }
  }
  const text = dictatedContentOf(call)
  if (text === undefined) return undefined
  return contentBodyOf({ text, running: state === EToolState.Running })
}
