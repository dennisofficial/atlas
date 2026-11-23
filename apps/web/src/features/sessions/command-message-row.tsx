'use client'

import { TerminalIcon } from 'lucide-react'

import { Message, MessageContent, MessageFooter } from '@dltech/atlas-ui/components/message'

const splitOf = (text: string): { name: string; argument: string } => {
  const at = text.indexOf(' ')
  return at === -1
    ? { name: text, argument: '' }
    : { name: text.slice(0, at), argument: text.slice(at) }
}

export function CommandMessageRow({
  text,
  timestamp,
}: {
  text: string
  timestamp?: string | undefined
}) {
  const { name, argument } = splitOf(text)
  return (
    <Message align="end">
      <div className="flex w-fit min-w-8 shrink-0 items-center justify-center self-end text-muted-foreground">
        <TerminalIcon aria-hidden className="size-3.5" />
      </div>
      <MessageContent>
        <p className="self-end text-end text-sm leading-relaxed wrap-break-word">
          <span className="font-mono font-medium text-primary">{name}</span>
          {argument === '' ? null : <span>{argument}</span>}
        </p>
        {timestamp === undefined ? null : (
          <MessageFooter>
            <span className="font-normal tabular-nums whitespace-nowrap">{timestamp}</span>
          </MessageFooter>
        )}
      </MessageContent>
    </Message>
  )
}
