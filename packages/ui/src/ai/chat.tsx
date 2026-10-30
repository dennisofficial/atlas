'use client'

import {
  Children,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { ArrowDownIcon } from 'lucide-react'
import { VList, type VListHandle } from 'virtua'

import { Button } from '#components/button'
import { cn } from '#lib/utils'

import { isAtEnd, shouldFollow } from './chat-follow'

export interface ChatProps {
  children: ReactNode
  jumpKey?: string | null
  className?: string
}

export interface ChatItemProps {
  id: string
  children: ReactNode
}

function Spacer() {
  return <div className="h-3" />
}

export function Chat({ children, jumpKey, className }: ChatProps) {
  const listRef = useRef<VListHandle>(null)
  const atEndRef = useRef(true)
  const lastOffsetRef = useRef(0)
  const scrolledUpRef = useRef(false)
  const previousJumpKey = useRef(jumpKey)
  const [showButton, setShowButton] = useState(false)
  const items = [
    <Spacer key="chat-top" />,
    ...Children.toArray(children),
    <Spacer key="chat-end" />,
  ]

  const scrollToEnd = useCallback(() => {
    listRef.current?.scrollToIndex(items.length - 1, { align: 'end' })
  }, [items.length])

  useLayoutEffect(() => {
    scrollToEnd()
  }, [])

  useLayoutEffect(() => {
    if (!shouldFollow({ wasAtEnd: atEndRef.current, scrolledUp: scrolledUpRef.current })) return
    scrollToEnd()
  }, [items.length, scrollToEnd])

  useEffect(() => {
    if (previousJumpKey.current === jumpKey) return
    previousJumpKey.current = jumpKey
    if (jumpKey === null || jumpKey === undefined) return
    atEndRef.current = true
    scrolledUpRef.current = false
    scrollToEnd()
  }, [jumpKey, scrollToEnd])

  const handleScroll = (offset: number) => {
    const list = listRef.current
    if (!list) return
    const atEnd = isAtEnd({
      scrollOffset: offset,
      viewportSize: list.viewportSize,
      scrollSize: list.scrollSize,
    })
    scrolledUpRef.current = offset < lastOffsetRef.current && !atEnd
    lastOffsetRef.current = offset
    atEndRef.current = atEnd
    setShowButton(!atEnd)
  }

  const handleResize = () => {
    if (!shouldFollow({ wasAtEnd: atEndRef.current, scrolledUp: scrolledUpRef.current })) return
    scrollToEnd()
  }

  const handleJumpClick = () => {
    atEndRef.current = true
    scrolledUpRef.current = false
    scrollToEnd()
  }

  return (
    <div
      data-slot="chat"
      role="log"
      aria-label="Messages"
      className={cn('relative flex size-full min-h-0 flex-col overflow-hidden', className)}
    >
      <VList
        ref={listRef}
        data-slot="chat-viewport"
        className="size-full min-h-0 min-w-0 scroll-fade-b scrollbar-thin scrollbar-gutter-stable overscroll-contain"
        onScroll={handleScroll}
        onResize={handleResize}
      >
        {items}
      </VList>
      <Button
        variant="outline"
        size="icon-sm"
        data-active={showButton}
        onClick={handleJumpClick}
        className="absolute inset-s-1/2 bottom-4 -translate-x-1/2 transition-[translate,scale,opacity] duration-200 data-[active=false]:pointer-events-none data-[active=false]:translate-y-full data-[active=false]:scale-95 data-[active=false]:opacity-0 data-[active=true]:translate-y-0 data-[active=true]:scale-100 data-[active=true]:opacity-100"
      >
        <ArrowDownIcon />
        <span className="sr-only">Scroll to end</span>
      </Button>
    </div>
  )
}

export function ChatItem({ id, children }: ChatItemProps) {
  return (
    <div
      data-slot="chat-item"
      data-chat-item-id={id}
      className="mx-auto w-full max-w-3xl min-w-0 px-4 py-3"
    >
      {children}
    </div>
  )
}
