'use client'

import type { ReactNode } from 'react'

import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from '#components/message-scroller'
import { cn } from '#lib/utils'

export interface ChatProps {
  children: ReactNode
  autoScroll?: boolean
  className?: string
  contentClassName?: string
}

export interface ChatItemProps {
  id: string
  anchor?: boolean
  children: ReactNode
}

export function Chat({ children, autoScroll = true, className, contentClassName }: ChatProps) {
  return (
    <MessageScrollerProvider autoScroll={autoScroll}>
      <MessageScroller className={className}>
        <MessageScrollerViewport>
          <MessageScrollerContent
            className={cn('mx-auto w-full max-w-3xl px-4 py-6', contentClassName)}
          >
            {children}
          </MessageScrollerContent>
        </MessageScrollerViewport>
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
