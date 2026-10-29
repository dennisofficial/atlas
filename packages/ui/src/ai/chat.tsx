'use client'

import { useEffect, useRef, type KeyboardEvent, type ReactNode, type WheelEvent } from 'react'

import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
  useMessageScroller,
} from '#components/message-scroller'
import { cn } from '#lib/utils'

import { isAtEnd, isDownwardKey, isDownwardWheel } from './chat-follow'

export interface ChatProps {
  children: ReactNode
  autoScroll?: boolean
  jumpKey?: string | null
  className?: string
  contentClassName?: string
}

export interface ChatItemProps {
  id: string
  anchor?: boolean
  children: ReactNode
}

function useJumpOnKeyChange(jumpKey: string | null | undefined) {
  const { scrollToEnd } = useMessageScroller()
  const previousKey = useRef(jumpKey)
  useEffect(() => {
    if (previousKey.current === jumpKey) return
    previousKey.current = jumpKey
    if (jumpKey === null || jumpKey === undefined) return
    scrollToEnd({ behavior: 'auto' })
  }, [jumpKey, scrollToEnd])
}

function ChatViewport({
  jumpKey,
  contentClassName,
  children,
}: {
  jumpKey: string | null | undefined
  contentClassName: string | undefined
  children: ReactNode
}) {
  const { scrollToEnd } = useMessageScroller()
  useJumpOnKeyChange(jumpKey)

  const resumeFollowingAtEnd = (viewport: HTMLElement) => {
    if (!isAtEnd(viewport)) return
    scrollToEnd({ behavior: 'auto' })
  }
  const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
    if (!isDownwardWheel(event.deltaY)) return
    resumeFollowingAtEnd(event.currentTarget)
  }
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!isDownwardKey(event.key)) return
    resumeFollowingAtEnd(event.currentTarget)
  }

  return (
    <MessageScrollerViewport onWheel={handleWheel} onKeyDown={handleKeyDown}>
      <MessageScrollerContent className={cn('mx-auto w-full max-w-3xl', contentClassName)}>
        {children}
      </MessageScrollerContent>
    </MessageScrollerViewport>
  )
}

export function Chat({
  children,
  autoScroll = true,
  jumpKey,
  className,
  contentClassName,
}: ChatProps) {
  return (
    <MessageScrollerProvider autoScroll={autoScroll}>
      <MessageScroller className={className}>
        <ChatViewport jumpKey={jumpKey} contentClassName={contentClassName}>
          {children}
        </ChatViewport>
        <MessageScrollerButton />
      </MessageScroller>
    </MessageScrollerProvider>
  )
}

export function ChatItem({ id, anchor = false, children }: ChatItemProps) {
  return (
    <MessageScrollerItem messageId={id} scrollAnchor={anchor}>
      {children}
    </MessageScrollerItem>
  )
}
