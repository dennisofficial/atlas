import type { ReactNode } from 'react'

export function AccessMemberSection({
  title,
  count,
  emptyText,
  action,
  children,
}: {
  title: string
  count: number
  emptyText: string
  action: ReactNode
  children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <h4 className="text-sm font-medium">
          {title}
          <span className="ml-2 font-mono text-xs text-muted-foreground">{count}</span>
        </h4>
        {action}
      </div>
      {count === 0 ? (
        <p className="text-xs text-muted-foreground">{emptyText}</p>
      ) : (
        <div className="divide-y rounded-lg border">{children}</div>
      )}
    </div>
  )
}
