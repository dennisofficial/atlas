'use client'

import { useState } from 'react'

import { Button } from '@dltech/atlas-ui/components/button'

export function ErrorDetails({ summary, reference }: { summary: string; reference: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = (): void => {
    void navigator.clipboard
      .writeText(`${summary}\n${reference}`)
      .then(() => setCopied(true))
      .catch(() => undefined)
  }

  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-border/60 bg-muted/40 p-2.5">
      <p className="select-text break-words font-mono text-[11px] leading-relaxed text-muted-foreground">
        {summary}
      </p>
      <p className="select-text break-all font-mono text-[11px] text-muted-foreground/80">
        {reference}
      </p>
      <Button variant="ghost" size="xs" className="self-start" onClick={handleCopy}>
        {copied ? 'Copied' : 'Copy details'}
      </Button>
    </div>
  )
}
