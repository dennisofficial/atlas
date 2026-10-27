'use client'

import { useState, type KeyboardEvent } from 'react'
import { ExternalLinkIcon } from 'lucide-react'

import { Button } from '@dltech/atlas-ui/components/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@dltech/atlas-ui/components/card'
import { Textarea } from '@dltech/atlas-ui/components/textarea'
import type { OperatorInputRequestWire } from '@dltech/atlas-wire/web'

export const OPERATOR_INPUT_TITLE = 'Atlas needs you'
export const OPERATOR_INPUT_PRIVACY = 'The model never sees what you paste.'

export type OperatorInputCardProps = {
  request: OperatorInputRequestWire
  submitting: boolean
  onSubmit: (value: string) => void
}

export function OperatorInputCard({ request, submitting, onSubmit }: OperatorInputCardProps) {
  const [value, setValue] = useState('')
  const canSubmit = value.length > 0 && !submitting

  const handleSubmit = () => {
    if (canSubmit) onSubmit(value)
  }
  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
    event.preventDefault()
    handleSubmit()
  }

  return (
    <Card size="sm" role="group" aria-label={OPERATOR_INPUT_TITLE}>
      <CardHeader>
        <CardTitle>{OPERATOR_INPUT_TITLE}</CardTitle>
        <CardDescription>{request.description}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-2">
          {request.url === undefined ? null : (
            <a
              href={request.url}
              target="_blank"
              rel="noreferrer"
              className="flex w-fit max-w-full items-center gap-1 truncate text-sm text-primary underline-offset-4 hover:underline"
            >
              <span className="truncate">{request.url}</span>
              <ExternalLinkIcon aria-hidden className="size-3.5 shrink-0" />
            </a>
          )}
          <Textarea
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={handleKeyDown}
            disabled={submitting}
            autoFocus
            spellCheck={false}
            autoComplete="off"
            aria-label="Paste here"
            placeholder="Paste here"
          />
        </div>
      </CardContent>
      <CardFooter>
        <p className="min-w-0 flex-1 text-xs text-muted-foreground">{OPERATOR_INPUT_PRIVACY}</p>
        <Button size="sm" disabled={!canSubmit} onClick={handleSubmit}>
          Send
        </Button>
      </CardFooter>
    </Card>
  )
}
