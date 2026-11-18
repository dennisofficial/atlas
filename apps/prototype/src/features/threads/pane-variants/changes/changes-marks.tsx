import { EFileChange, formatCount } from '@dltech/atlas-ui/ai/changes-panel'
import { cn } from '@dltech/atlas-ui/lib/utils'

export enum EMark {
  Added = 'A',
  Modified = 'M',
  Deleted = 'D',
  Renamed = 'R',
}

const MARK_CLASS: Record<EMark, string> = {
  [EMark.Added]: 'text-diff-add-foreground',
  [EMark.Modified]: 'text-warning',
  [EMark.Deleted]: 'text-diff-remove-foreground',
  [EMark.Renamed]: 'text-primary',
}

export function markOf(entry: { change: EFileChange; from?: string }): EMark {
  if (entry.from !== undefined) return EMark.Renamed
  if (entry.change === EFileChange.Added) return EMark.Added
  if (entry.change === EFileChange.Deleted) return EMark.Deleted
  return EMark.Modified
}

export function markClassOf(mark: EMark): string {
  return MARK_CLASS[mark]
}

export function ChangeCounts({ added, removed }: { added: number; removed: number }) {
  return (
    <span className="flex shrink-0 items-center gap-1.5 font-mono text-xs tabular-nums">
      <span className="text-diff-add-foreground">+{formatCount(added)}</span>
      <span className="text-diff-remove-foreground">−{formatCount(removed)}</span>
    </span>
  )
}

export function ChangeMark({ mark }: { mark: EMark }) {
  return (
    <span
      className={cn('w-3 shrink-0 text-center font-mono text-xs font-semibold', markClassOf(mark))}
    >
      {mark}
    </span>
  )
}
