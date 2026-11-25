'use client'

import { Terminal } from 'lucide-react'
import { toast } from 'sonner'

import type { ShellRoster } from '@dltech/atlas-plugin-shells/client'

import { Button } from '@dltech/atlas-ui/components/button'
import { Popover, PopoverContent, PopoverTrigger } from '@dltech/atlas-ui/components/popover'

import { messageOf } from '@/features/threads/data/message-of'

import { killShell } from './data/shell-actions'
import { sessionsApi } from './data/sessions-api'

const SHELL_TAIL_LINES = 20

const SHELL_TAIL_CHARACTERS = 4_000

export function shellTailOf(text: string | undefined): string {
  if (text === undefined) return ''
  const tail = text.split('\n').slice(-SHELL_TAIL_LINES).join('\n')
  return tail.slice(-SHELL_TAIL_CHARACTERS)
}

function ShellStop({ shellId, sessionId }: { shellId: string; sessionId: string }) {
  const handleStop = () => {
    killShell({ api: sessionsApi, sessionId, shellId }).catch((failure: unknown) => {
      toast.error(messageOf(failure))
    })
  }
  return (
    <Button type="button" variant="ghost" size="row" data-shell-kill={shellId} onClick={handleStop}>
      Stop
    </Button>
  )
}

export function ShellTails({
  shells,
  tails,
  sessionId,
}: {
  shells: ShellRoster
  tails: Readonly<Record<string, string>>
  sessionId?: string | undefined
}) {
  return (
    <ul data-shell-tails className="flex flex-col gap-2.5">
      {shells.rows.map((row) => {
        const tail = shellTailOf(tails[row.shellId])
        return (
          <li key={row.shellId} className="flex min-w-0 flex-col gap-1">
            <span className="flex min-w-0 items-center justify-between gap-2">
              <span className="truncate font-mono text-xs text-muted-foreground" title={row.name}>
                {row.name}
              </span>
              {sessionId === undefined ? null : (
                <ShellStop shellId={row.shellId} sessionId={sessionId} />
              )}
            </span>
            {tail === '' ? (
              <span className="text-xs text-muted-foreground italic">No output yet</span>
            ) : (
              <pre
                data-shell-tail={row.shellId}
                className="max-h-40 overflow-auto rounded-md bg-muted/40 p-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-words"
              >
                {tail}
              </pre>
            )}
          </li>
        )
      })}
    </ul>
  )
}

export function HeaderShells({
  shells,
  tails,
  sessionId,
}: {
  shells: ShellRoster
  tails: Readonly<Record<string, string>>
  sessionId?: string | undefined
}) {
  return (
    <Popover>
      <PopoverTrigger
        data-session-shells
        aria-label={`Running shells: ${shells.running}`}
        title={shells.labels.join(', ')}
        render={
          <Button
            variant="ghost"
            size="sm"
            className="text-xs text-muted-foreground tabular-nums"
          />
        }
      >
        <Terminal className="size-3" aria-hidden />
        <span className="font-mono">{shells.running}</span>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[32rem] max-w-[calc(100vw-2rem)]">
        <ShellTails shells={shells} tails={tails} sessionId={sessionId} />
      </PopoverContent>
    </Popover>
  )
}
