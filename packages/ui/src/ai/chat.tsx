'use client'

import {
  Children,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  type TouchEvent,
  type WheelEvent,
} from 'react'
import { ArrowDownIcon } from 'lucide-react'
import { VList, type VListHandle } from 'virtua'

import { Button } from '#components/button'
import { cn } from '#lib/utils'

import {
  EChatFollow,
  EFollowEvent,
  isAtEnd,
  isDetachingKey,
  isUpwardTouch,
  isUpwardWheel,
  isUserDriven,
  nextFollow,
  type FollowEvent,
} from './chat-follow'

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

function isEditableTarget(target: EventTarget): boolean {
  return (
    target instanceof HTMLElement &&
    target.closest('input, textarea, [contenteditable="true"]') !== null
  )
}

export function Chat({ children, jumpKey, className }: ChatProps) {
  const listRef = useRef<VListHandle>(null)
  const followRef = useRef(EChatFollow.Attached)
  const lastInputAtRef = useRef(Number.NEGATIVE_INFINITY)
  const touchYRef = useRef<number | null>(null)
  const pointerHeldRef = useRef(false)
  const previousJumpKey = useRef(jumpKey)
  const [detached, setDetached] = useState(false)
  const items = [
    <Spacer key="chat-top" />,
    ...Children.toArray(children),
    <Spacer key="chat-end" />,
  ]

  const scrollToEnd = useCallback(() => {
    listRef.current?.scrollToIndex(items.length - 1, { align: 'end' })
  }, [items.length])

  const dispatch = useCallback((event: FollowEvent) => {
    const next = nextFollow(followRef.current, event)
    followRef.current = next
    setDetached(next === EChatFollow.Detached)
  }, [])

  const followIfAttached = useCallback(() => {
    if (followRef.current !== EChatFollow.Attached) return
    scrollToEnd()
  }, [scrollToEnd])

  useLayoutEffect(() => {
    scrollToEnd()
  }, [])

  useLayoutEffect(() => {
    followIfAttached()
  }, [items.length, followIfAttached])

  useEffect(() => {
    if (previousJumpKey.current === jumpKey) return
    previousJumpKey.current = jumpKey
    if (jumpKey === null || jumpKey === undefined) return
    dispatch({ type: EFollowEvent.Reattached })
    scrollToEnd()
  }, [jumpKey, scrollToEnd, dispatch])

  const noteInput = () => {
    lastInputAtRef.current = Date.now()
  }

  const detachFromInput = () => {
    noteInput()
    const list = listRef.current
    if (!list || list.scrollSize <= list.viewportSize) return
    dispatch({ type: EFollowEvent.UserScrolledUp })
  }

  const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
    if (!isUpwardWheel(event.deltaY)) return noteInput()
    detachFromInput()
  }

  const handleTouchStart = (event: TouchEvent<HTMLDivElement>) => {
    noteInput()
    touchYRef.current = event.touches[0]?.clientY ?? null
  }

  const handleTouchMove = (event: TouchEvent<HTMLDivElement>) => {
    const currentY = event.touches[0]?.clientY
    const previousY = touchYRef.current
    touchYRef.current = currentY ?? null
    noteInput()
    if (currentY === undefined || previousY === null) return
    if (!isUpwardTouch({ previousY, currentY })) return
    detachFromInput()
  }

  const handleTouchEnd = () => {
    touchYRef.current = null
    noteInput()
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (isEditableTarget(event.target)) return
    if (!isDetachingKey(event.key)) return noteInput()
    detachFromInput()
  }

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'mouse' || event.target !== event.currentTarget) return
    pointerHeldRef.current = true
    const release = () => {
      pointerHeldRef.current = false
      window.removeEventListener('pointerup', release)
      window.removeEventListener('pointercancel', release)
    }
    window.addEventListener('pointerup', release)
    window.addEventListener('pointercancel', release)
    detachFromInput()
  }

  const handleScroll = (offset: number) => {
    const list = listRef.current
    if (!list) return
    const now = Date.now()
    const userDriven = isUserDriven({
      now,
      lastInputAt: lastInputAtRef.current,
      pointerHeld: pointerHeldRef.current || touchYRef.current !== null,
    })
    if (userDriven) lastInputAtRef.current = now
    dispatch({
      type: EFollowEvent.Scrolled,
      atEnd: isAtEnd({
        scrollOffset: offset,
        viewportSize: list.viewportSize,
        scrollSize: list.scrollSize,
      }),
      userDriven,
    })
  }

  const handleJumpClick = () => {
    dispatch({ type: EFollowEvent.Reattached })
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
        onResize={followIfAttached}
        onWheel={handleWheel}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
        onKeyDown={handleKeyDown}
        onPointerDown={handlePointerDown}
      >
        {items}
      </VList>
      <Button
        variant="outline"
        size="icon-sm"
        data-active={detached}
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
