import { HEAD } from './details-fixtures'

export function HeadSection({ title }: { title: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <p className="line-clamp-2 text-sm font-medium">{title}</p>
      <p className="text-xs text-muted-foreground tabular-nums">
        {HEAD.turns} · {HEAD.cost}
      </p>
      <p className="font-mono text-xs text-muted-foreground tabular-nums">{HEAD.tokens}</p>
    </div>
  )
}
