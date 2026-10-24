import Link from 'next/link'
import type { ComponentProps, ReactNode } from 'react'

import { Button } from '@dltech/atlas-ui/components/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@dltech/atlas-ui/components/tooltip'

export function RowAction({
  label,
  href,
  external = false,
  onClick,
  children,
}: {
  label: string
  href?: string
  external?: boolean
  onClick?: () => void
  children: ReactNode
}) {
  const linkProps =
    href === undefined
      ? {}
      : {
          nativeButton: false,
          render: external ? (
            (props: ComponentProps<'a'>) => (
              <a {...props} href={href} target="_blank" rel="noreferrer" />
            )
          ) : (
            <Link href={href} />
          ),
        }
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={label}
            {...(onClick === undefined ? {} : { onClick })}
            {...linkProps}
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
