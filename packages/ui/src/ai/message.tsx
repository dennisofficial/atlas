'use client'

import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import {
  CheckIcon,
  CopyIcon,
  HistoryIcon,
  PencilIcon,
  RefreshCcwIcon,
  Trash2Icon,
  ThumbsDownIcon,
  ThumbsUpIcon,
} from 'lucide-react'

import { cn } from 'cn'

import { Bubble, BubbleContent } from '#components/bubble'
import { Button } from '#components/button'
import { Marker, MarkerContent, MarkerIcon } from '#components/marker'
import { Message, MessageContent, MessageFooter } from '#components/message'
import { Tooltip, TooltipContent, TooltipTrigger } from '#components/tooltip'

import { InboundBubble } from './internal/inbound-bubble'
import {
  hasSummariseAction,
  SummariseAction,
  type SummariseActions,
} from './internal/summarise-action'
import { readingClasses } from '../tokens'
import { MessageAttachments, type MessageAttachment } from './message-images'

export type { MessageAttachment, MessageImage } from './message-images'

export enum EFeedback {
  Good = 'good',
  Bad = 'bad',
}

export interface UserMessageProps extends SummariseActions {
  children?: ReactNode
  author?: string
  timestamp?: string
  attachments?: readonly MessageAttachment[]
  copyText?: string
  actionsDisabled?: boolean
  onEdit?: () => void
  onRemove?: () => void
  onRewind?: () => void
}

export interface AgentMessageProps {
  children: ReactNode
  author?: string
  caption?: string
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
  disabled?: boolean
  onClick?: () => void
  className?: string
  children: ReactNode
}

function ActionButton({
  label,
  pressed,
  disabled,
  onClick,
  className,
  children,
}: ActionButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={label}
            aria-pressed={pressed}
            disabled={disabled}
            onClick={onClick}
            className={className}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

function CopyAction({ text, disabled }: { text: string; disabled?: boolean }) {
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
    <ActionButton label={copied ? 'Copied' : 'Copy'} disabled={disabled} onClick={handleCopy}>
      {copied ? <CheckIcon /> : <CopyIcon />}
    </ActionButton>
  )
}

function SpeakerName({ author }: { author: string | undefined }) {
  return author ? <span className="sr-only">{author}</span> : null
}

function Timestamp({ children }: { children: string }) {
  return <span className="font-normal tabular-nums whitespace-nowrap">{children}</span>
}

function FooterRow({ children }: { children: ReactNode }) {
  return <div className="flex items-center gap-2">{children}</div>
}

function ActionGroup({ children }: { children: ReactNode }) {
  return <div className="flex items-center">{children}</div>
}

export function UserMessage({
  children,
  author,
  timestamp,
  attachments = [],
  copyText,
  actionsDisabled = false,
  onEdit,
  onRemove,
  onRewind,
  onSummariseUpTo,
}: UserMessageProps) {
  const userCopyText = copyText?.trim() ? copyText : undefined
  const summarise = { onSummariseUpTo }
  const hasActions = Boolean(
    onEdit || onRemove || userCopyText || onRewind || hasSummariseAction(summarise),
  )

  return (
    <Message align="end">
      <MessageContent>
        <SpeakerName author={author} />
        <MessageAttachments attachments={attachments} />
        {children === undefined || children === null ? null : (
          <Bubble align="end" variant="muted">
            <BubbleContent className={readingClasses.body}>{children}</BubbleContent>
          </Bubble>
        )}
        {timestamp || hasActions ? (
          <MessageFooter>
            <FooterRow>
              {timestamp ? <Timestamp>{timestamp}</Timestamp> : null}
              {hasActions ? (
                <ActionGroup>
                  {onEdit ? (
                    <ActionButton label="Edit" disabled={actionsDisabled} onClick={onEdit}>
                      <PencilIcon />
                    </ActionButton>
                  ) : null}
                  {userCopyText ? (
                    <CopyAction text={userCopyText} disabled={actionsDisabled} />
                  ) : null}
                  {onRewind ? (
                    <ActionButton
                      label="Rewind to here"
                      disabled={actionsDisabled}
                      onClick={onRewind}
                    >
                      <HistoryIcon />
                    </ActionButton>
                  ) : null}
                  <SummariseAction {...summarise} />
                  {onRemove ? (
                    <ActionButton
                      label="Remove"
                      disabled={actionsDisabled}
                      onClick={onRemove}
                      className="hover:text-destructive"
                    >
                      <Trash2Icon />
                    </ActionButton>
                  ) : null}
                </ActionGroup>
              ) : null}
            </FooterRow>
          </MessageFooter>
        ) : null}
      </MessageContent>
    </Message>
  )
}

export function AgentMessage({
  children,
  author,
  caption,
  timestamp,
  streaming = false,
  caret = true,
  copyText,
  feedback,
  onFeedback,
  onRetry,
}: AgentMessageProps) {
  const showActions = Boolean(copyText || onFeedback || onRetry) && !streaming

  return (
    <Message>
      <MessageContent>
        <SpeakerName author={author} />
        {caption === undefined ? (
          <div className={cn(readingClasses.body, 'text-pretty')}>
            {children}
            {streaming && caret ? (
              <span
                aria-hidden
                className="ml-1 inline-block h-[1.05em] w-0.5 translate-y-0.5 animate-pulse bg-primary"
              />
            ) : null}
          </div>
        ) : (
          <InboundBubble caption={caption}>{children}</InboundBubble>
        )}
        {timestamp || showActions ? (
          <MessageFooter>
            <FooterRow>
              {showActions ? (
                <ActionGroup>
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
                </ActionGroup>
              ) : null}
              {timestamp ? <Timestamp>{timestamp}</Timestamp> : null}
            </FooterRow>
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
