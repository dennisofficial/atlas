'use client'

import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import {
  CheckIcon,
  CopyIcon,
  PencilIcon,
  RefreshCcwIcon,
  ThumbsDownIcon,
  ThumbsUpIcon,
} from 'lucide-react'

import { Bubble, BubbleContent } from '#components/bubble'
import { Button } from '#components/button'
import { Marker, MarkerContent, MarkerIcon } from '#components/marker'
import { Message, MessageContent, MessageFooter, MessageHeader } from '#components/message'
import { Tooltip, TooltipContent, TooltipTrigger } from '#components/tooltip'

export enum EFeedback {
  Good = 'good',
  Bad = 'bad',
}

export interface MessageAttachment {
  id: string
  label: string
}

export interface UserMessageProps {
  children: ReactNode
  author?: string
  timestamp?: string
  attachments?: MessageAttachment[]
  onEdit?: () => void
}

export interface AgentMessageProps {
  children: ReactNode
  author?: string
  timestamp?: string
  streaming?: boolean
  caret?: boolean
  copyText?: string
  feedback?: EFeedback
  onFeedback?: (feedback: EFeedback) => void
  onRetry?: () => void
}

interface ActionButtonProps {
  label: string
  pressed?: boolean
  onClick?: () => void
  children: ReactNode
}

function ActionButton({ label, pressed, onClick, children }: ActionButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={label}
            aria-pressed={pressed}
            onClick={onClick}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

function CopyAction({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return undefined
    const timeout = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(timeout)
  }, [copied])

  const handleCopy = () => {
    navigator.clipboard
      .writeText(text)
      .then(() => setCopied(true))
      .catch(() => {})
  }

  return (
    <ActionButton label={copied ? 'Copied' : 'Copy'} onClick={handleCopy}>
      {copied ? <CheckIcon /> : <CopyIcon />}
    </ActionButton>
  )
}

function Meta({ author, timestamp }: Pick<UserMessageProps, 'author' | 'timestamp'>) {
  if (!author && !timestamp) return null
  return (
    <MessageHeader>
      {author ? <span>{author}</span> : null}
      {timestamp ? <span className="font-normal tabular-nums">{timestamp}</span> : null}
    </MessageHeader>
  )
}

export function UserMessage({
  children,
  author,
  timestamp,
  attachments = [],
  onEdit,
}: UserMessageProps) {
  return (
    <Message align="end">
      <MessageContent>
        <Meta author={author} timestamp={timestamp} />
        <Bubble align="end" variant="muted">
          <BubbleContent>{children}</BubbleContent>
        </Bubble>
        {attachments.length > 0 ? (
          <div className="flex flex-wrap justify-end gap-1.5">
            {attachments.map((attachment) => (
              <span
                key={attachment.id}
                className="rounded-md bg-muted px-2 py-0.5 font-mono text-xs text-muted-foreground"
              >
                {attachment.label}
              </span>
            ))}
          </div>
        ) : null}
        {onEdit ? (
          <MessageFooter>
            <ActionButton label="Edit" onClick={onEdit}>
              <PencilIcon />
            </ActionButton>
          </MessageFooter>
        ) : null}
      </MessageContent>
    </Message>
  )
}

export function AgentMessage({
  children,
  author,
  timestamp,
  streaming = false,
  caret = true,
  copyText,
  feedback,
  onFeedback,
  onRetry,
}: AgentMessageProps) {
  const hasActions = Boolean(copyText || onFeedback || onRetry)

  return (
    <Message>
      <MessageContent>
        <Meta author={author} timestamp={timestamp} />
        <div className="text-sm leading-relaxed text-pretty">
          {children}
          {streaming && caret ? (
            <span
              aria-hidden
              className="ml-1 inline-block h-[1.05em] w-0.5 translate-y-0.5 animate-pulse bg-primary"
            />
          ) : null}
        </div>
        {hasActions && !streaming ? (
          <MessageFooter>
            {copyText ? <CopyAction text={copyText} /> : null}
            {onFeedback ? (
              <>
                <ActionButton
                  label="Good response"
                  pressed={feedback === EFeedback.Good}
                  onClick={() => onFeedback(EFeedback.Good)}
                >
                  <ThumbsUpIcon />
                </ActionButton>
                <ActionButton
                  label="Bad response"
                  pressed={feedback === EFeedback.Bad}
                  onClick={() => onFeedback(EFeedback.Bad)}
                >
                  <ThumbsDownIcon />
                </ActionButton>
              </>
            ) : null}
            {onRetry ? (
              <ActionButton label="Retry" onClick={onRetry}>
                <RefreshCcwIcon />
              </ActionButton>
            ) : null}
          </MessageFooter>
        ) : null}
      </MessageContent>
    </Message>
  )
}

export function HarnessMessage({ children }: { children: ReactNode }) {
  return (
    <Marker variant="separator">
      <MarkerIcon />
      <MarkerContent>{children}</MarkerContent>
    </Marker>
  )
}
