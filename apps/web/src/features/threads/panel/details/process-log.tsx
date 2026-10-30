'use client'

import { useLayoutEffect, useMemo, useRef } from 'react'

import { plainLogOf } from '../../data/processes-model'

export const NOTHING_PRINTED = 'It has printed nothing yet.'

const STUCK_SLACK_PX = 8

export function ProcessLog(props: { text: string | null; caption: string | undefined }) {
  const scrollRef = useRef<HTMLPreElement>(null)
  const stuckRef = useRef(true)
  const plain = useMemo(() => (props.text === null ? '' : plainLogOf(props.text)), [props.text])

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
    <div className="flex min-h-0 flex-1 flex-col gap-1">
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
          className="min-h-0 flex-1 overflow-auto rounded-md bg-muted/50 px-2.5 py-2 font-mono text-xs leading-relaxed break-all whitespace-pre-wrap"
        >
          {plain}
        </pre>
      )}
    </div>
  )
}
