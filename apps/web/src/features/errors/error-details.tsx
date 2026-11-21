'use client'

import { useEffect, useMemo, useState } from 'react'

import { Button } from '@dltech/atlas-ui/components/button'

import { captureException } from '@/lib/analytics/analytics'

import { detailsTextOf, errorReportOf, newReferenceId } from './error-report'

const COPIED_MS = 1500

async function copyText(text: string): Promise<void> {
  await navigator.clipboard.writeText(text)
}

export function ErrorDetails({ error }: { error: Error & { digest?: string } }) {
  const generatedId = useMemo(newReferenceId, [])
  const report = useMemo(
    () => errorReportOf({ error, referenceId: generatedId }),
    [error, generatedId],
  )
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    captureException(error, {
      reference_id: report.referenceId,
      ...(report.requestId === undefined ? {} : { request_id: report.requestId }),
    })
  }, [error, report])

  useEffect(() => {
    if (!copied) return undefined
    const timer = setTimeout(() => setCopied(false), COPIED_MS)
    return () => clearTimeout(timer)
  }, [copied])

  const handleCopy = (): void => {
    const url = typeof window === 'undefined' ? '' : window.location.href
    void copyText(detailsTextOf({ report, url }))
      .then(() => setCopied(true))
      .catch(() => undefined)
  }

  const reference =
    report.requestId === undefined
      ? report.referenceId
      : `${report.referenceId} · Request ${report.requestId}`

  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-border/60 bg-muted/40 p-2.5">
      <p
        data-slot="error-summary"
        className="select-text break-words font-mono text-[11px] leading-relaxed text-muted-foreground"
      >
        {report.summary}
      </p>
      <p
        data-slot="error-reference"
        className="select-text break-all font-mono text-[11px] text-muted-foreground/80"
      >
        {reference}
      </p>
      <Button variant="ghost" size="xs" className="self-start" onClick={handleCopy}>
        {copied ? 'Copied' : 'Copy details'}
      </Button>
    </div>
  )
}
