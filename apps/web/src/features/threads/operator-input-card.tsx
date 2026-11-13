'use client'

import { useState, type ChangeEvent, type KeyboardEvent } from 'react'
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
import { Input } from '@dltech/atlas-ui/components/input'
import { Textarea } from '@dltech/atlas-ui/components/textarea'

export const OPERATOR_INPUT_TITLE = 'Atlas needs you'
export const OPERATOR_INPUT_PRIVACY = 'The model never sees what you paste.'
export const OPERATOR_INPUT_WAITING = 'Waiting for the session to confirm.'

export type OperatorInputRequest = {
  requestId: string
  description: string
  url?: string | undefined
  secret?: boolean | undefined
}

export type OperatorInputCardProps = OperatorInputRequest & {
  submitting: boolean
  error?: string | undefined
  onSubmit: (value: string) => void
  onCancel?: (() => void) | undefined
}

export function OperatorInputCard(props: OperatorInputCardProps) {
  const { description, url, secret, submitting, error, onSubmit, onCancel } = props
  const [value, setValue] = useState('')
  const canSubmit = value.length > 0 && !submitting

  const handleSubmit = () => {
    if (!canSubmit) return
    onSubmit(value)
    setValue('')
  }
  const handleCancel = () => {
    if (submitting || onCancel === undefined) return
    onCancel()
  }
  const handleChange = (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setValue(event.target.value)
  }
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return
    if (event.key === 'Escape') {
      event.preventDefault()
      handleCancel()
      return
    }
    if (event.key !== 'Enter' || event.shiftKey) return
    event.preventDefault()
    handleSubmit()
  }

  const field = {
    value,
    onChange: handleChange,
    onKeyDown: handleKeyDown,
    disabled: submitting,
    autoFocus: true,
    spellCheck: false,
    autoComplete: 'off',
    'aria-label': 'Paste here',
    placeholder: 'Paste here',
  }

  return (
    <Card size="sm" role="group" aria-label={OPERATOR_INPUT_TITLE}>
      <CardHeader>
        <CardTitle>{OPERATOR_INPUT_TITLE}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-2">
          {url === undefined ? null : (
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="flex w-fit max-w-full items-center gap-1 truncate text-sm text-primary underline-offset-4 hover:underline"
            >
              <span className="truncate">{url}</span>
              <ExternalLinkIcon aria-hidden className="size-3.5 shrink-0" />
            </a>
          )}
          {secret === true ? <Input type="password" {...field} /> : <Textarea {...field} />}
          {error === undefined ? null : (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
        </div>
      </CardContent>
      <CardFooter>
        <p className="min-w-0 flex-1 text-xs text-muted-foreground">
          {submitting ? OPERATOR_INPUT_WAITING : OPERATOR_INPUT_PRIVACY}
        </p>
        {onCancel === undefined ? null : (
          <Button size="sm" variant="ghost" disabled={submitting} onClick={handleCancel}>
            Cancel
          </Button>
        )}
        <Button size="sm" disabled={!canSubmit} onClick={handleSubmit}>
          Send
        </Button>
      </CardFooter>
    </Card>
  )
}
