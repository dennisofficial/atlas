'use client'

import { useEffect, useRef } from 'react'

import { cn } from '@dltech/atlas-ui/lib/utils'

export function SkillEditor({
  value,
  readOnly,
  onChange,
}: {
  value: string
  readOnly: boolean
  onChange: (value: string) => void
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const numbersRef = useRef<HTMLDivElement>(null)
  const lines = value.split('\n').length

  const handleScroll = () => {
    if (numbersRef.current && textareaRef.current) {
      numbersRef.current.scrollTop = textareaRef.current.scrollTop
    }
  }

  useEffect(() => {
    handleScroll()
  })

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden rounded-md border bg-background font-mono text-xs">
      <div
        ref={numbersRef}
        aria-hidden
        className="w-10 shrink-0 overflow-hidden border-r bg-muted/30 py-2 text-right text-muted-foreground/60 select-none"
      >
        {Array.from({ length: lines }, (_, index) => (
          <div key={index} className="h-5 pr-2 leading-5 tabular-nums">
            {index + 1}
          </div>
        ))}
      </div>
      <textarea
        ref={textareaRef}
        aria-label="File contents"
        spellCheck={false}
        readOnly={readOnly}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onScroll={handleScroll}
        className={cn(
          'min-w-0 flex-1 resize-none bg-transparent p-2 leading-5 outline-none',
          readOnly && 'text-muted-foreground',
        )}
      />
    </div>
  )
}
