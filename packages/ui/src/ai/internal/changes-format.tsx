import { formatCount } from './changes-math'

const MINUS = '−'

export function Counts({ added, removed }: { added: number; removed: number }) {
  return (
    <span className="flex shrink-0 items-center gap-1.5 font-mono text-xs tabular-nums">
      <span className="text-diff-add-foreground">+{formatCount(added)}</span>
      <span className="text-diff-remove-foreground">
        {MINUS}
        {formatCount(removed)}
      </span>
    </span>
  )
}
