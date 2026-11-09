import { Gauge } from 'lucide-react'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { toast } from 'sonner'

import { Button } from '@dltech/atlas-ui/components/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@dltech/atlas-ui/components/tooltip'
import type { SessionCommandInput, SessionCommandOutput } from '@dltech/atlas-protocol'
import { sessionsApi } from '@/features/sessions/data/sessions-api'
import { messageOf } from '@/features/threads/data/use-send'

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
  const linkProps =
    href === undefined
      ? {}
      : {
          nativeButton: false,
          render: <Link href={href} />,
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
            className="text-muted-foreground"
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  )
}

export type SessionCommandApi = {
  command(input: SessionCommandInput): Promise<SessionCommandOutput>
}

export const requestResetPeerBudget = async (args: {
  api: SessionCommandApi
  sessionId: string
}): Promise<void> => {
  await args.api.command({ sessionId: args.sessionId, name: 'reset-peer-budget', args: {} })
}

export function ResetPeerBudgetAction({ sessionId }: { sessionId: string }) {
  const handleReset = () => {
    requestResetPeerBudget({ api: sessionsApi, sessionId }).catch((failure) =>
      toast.error(messageOf(failure)),
    )
  }
  return (
    <RowAction label="Reset peer budget" onClick={handleReset}>
      <Gauge />
    </RowAction>
  )
}
