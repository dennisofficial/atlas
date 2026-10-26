import Link from 'next/link'
import type { ReactNode } from 'react'

import { Button } from '@dltech/atlas-ui/components/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@dltech/atlas-ui/components/tooltip'

export function RowAction({
  label,
  href,
  onClick,
  children,
}: {
  label: string
  href?: string
  onClick?: () => void
  children: ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={label}
            {...(onClick === undefined ? {} : { onClick })}
            {...(href === undefined ? {} : { nativeButton: false, render: <Link href={href} /> })}
            className="size-5 text-muted-foreground hover:bg-sidebar-border hover:text-foreground [&_svg:not([class*='size-'])]:size-3.5"
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  )
}
