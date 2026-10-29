'use client'

import { useLayoutEffect, useRef, type ReactNode } from 'react'
import { CircleCheckIcon, CircleIcon, CircleXIcon, TriangleAlertIcon } from 'lucide-react'

import { Button } from '@dltech/atlas-ui/components/button'
import { Item, ItemActions } from '@dltech/atlas-ui/components/item'
import { cn } from '@dltech/atlas-ui/lib/utils'

import { EProcessTone, plainLogOf } from '../data/processes-model'

export const NOTHING_PRINTED = 'It has printed nothing yet.'

export const STDIN_CLOSED =
  'Its stdin is closed, so nothing can answer it. Kill it and re-run with input piped in.'

const STUCK_SLACK_PX = 8

const TONE_MARK: Record<EProcessTone, ReactNode> = {
  [EProcessTone.Running]: <CircleIcon className="size-2.5 fill-current text-success" />,
  [EProcessTone.Waiting]: <TriangleAlertIcon className="size-3.5 text-warning" />,
  [EProcessTone.Failed]: <CircleXIcon className="size-3.5 text-destructive" />,
  [EProcessTone.Settled]: <CircleCheckIcon className="size-3.5 text-muted-foreground" />,
}

function ProcessLog(props: { text: string | null; caption: string | undefined }) {
  const scrollRef = useRef<HTMLPreElement>(null)
  const stuckRef = useRef(true)
  const plain = props.text === null ? '' : plainLogOf(props.text)

  useLayoutEffect(() => {
    const element = scrollRef.current
    if (element !== null && stuckRef.current) element.scrollTop = element.scrollHeight
  }, [plain])

  const handleScroll = () => {
    const element = scrollRef.current
    if (element === null) return
    const fromBottom = element.scrollHeight - element.scrollTop - element.clientHeight
    stuckRef.current = fromBottom <= STUCK_SLACK_PX
  }

  return (
    <div className="flex basis-full flex-col gap-1">
      {props.caption === undefined ? null : (
        <span className="font-mono text-xs text-muted-foreground tabular-nums">
          {props.caption}
        </span>
      )}
      {plain === '' ? (
        <p className="rounded-md bg-muted/50 px-2.5 py-2 text-xs text-muted-foreground">
          {NOTHING_PRINTED}
        </p>
      ) : (
        <pre
          ref={scrollRef}
          onScroll={handleScroll}
          className="max-h-64 overflow-auto rounded-md bg-muted/50 px-2.5 py-2 font-mono text-xs leading-relaxed break-all whitespace-pre-wrap"
        >
          {plain}
        </pre>
      )}
    </div>
  )
}

export type ProcessRowProps = {
  name: string
  command: string | undefined
  readout: string
  tone: EProcessTone
  warning: string | undefined
  action: { label: string; busy: boolean; onAction: () => void } | undefined
  expanded: boolean
  onToggle: () => void
  log: string | null
  logCaption: string | undefined
}

export function ProcessRow(props: ProcessRowProps) {
  const { name, command, readout, tone, warning, action, expanded } = props
  return (
    <Item variant="outline" size="sm" role="listitem" data-tone={tone}>
      <button
        type="button"
        aria-expanded={expanded}
        onClick={props.onToggle}
        className="flex min-w-0 flex-1 flex-col items-start gap-0.5 rounded-sm text-left outline-hidden focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <span className="flex w-full min-w-0 items-center gap-2">
          <span aria-hidden className="flex size-4 shrink-0 items-center justify-center">
            {TONE_MARK[tone]}
          </span>
          <span className="truncate font-medium">{name}</span>
        </span>
        <span className="flex w-full min-w-0 items-center gap-1.5 pl-6 text-xs text-muted-foreground">
          <span className={cn('shrink-0', tone === EProcessTone.Waiting && 'text-warning')}>
            {readout}
          </span>
          {command === undefined ? null : (
            <span className="truncate font-mono" title={command}>
              {command}
            </span>
          )}
        </span>
      </button>
      {action === undefined ? null : (
        <ItemActions>
          <Button
            variant="destructive"
            size="xs"
            disabled={action.busy}
            aria-label={`${action.label} ${name}`}
            onClick={action.onAction}
          >
            {action.label}
          </Button>
        </ItemActions>
      )}
      {warning === undefined ? null : (
        <p className="basis-full pl-6 text-xs text-warning">{warning}</p>
      )}
      {expanded ? <ProcessLog text={props.log} caption={props.logCaption} /> : null}
    </Item>
  )
}
