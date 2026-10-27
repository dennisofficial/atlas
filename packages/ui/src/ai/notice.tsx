import type { ReactNode } from 'react'

export interface NoticeProps {
  icon: ReactNode
  title: string
  description: string
  action?: ReactNode
}

export function Notice({ icon, title, description, action }: NoticeProps) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
      <div className="flex size-9 items-center justify-center rounded-lg border border-border bg-muted text-muted-foreground [&_svg]:size-4">
        {icon}
      </div>
      <div className="flex max-w-64 flex-col gap-1">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      {action}
    </div>
  )
}
