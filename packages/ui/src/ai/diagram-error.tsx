'use client'

import { useEffect, useRef, useState } from 'react'
import { TriangleAlertIcon } from 'lucide-react'

import { Alert, AlertDescription, AlertTitle } from '#components/alert'
import { Button } from '#components/button'
import { CodeBlockCopyButton } from '#components/code-block'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '#components/collapsible'
import { Spinner } from '#components/spinner'
import { summarizeDiagramError } from './internal/diagram-error-summary'

export type DiagramRepairArgs = { chart: string; error: string }

export type DiagramErrorProps = {
  chart: string
  error: string
  onRepair?: (args: DiagramRepairArgs) => Promise<void>
}

type Failure = { chart: string; message: string }

function messageOf(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}

export function DiagramError({ chart, error, onRepair }: DiagramErrorProps) {
  const [sourceOpen, setSourceOpen] = useState(false)
  const requested = useRef<string | undefined>(undefined)
  const [pendingChart, setPendingChart] = useState<string | undefined>(undefined)
  const [failure, setFailure] = useState<Failure | undefined>(undefined)

  useEffect(() => {
    if (onRepair === undefined || requested.current === chart) return
    requested.current = chart
    setPendingChart(chart)
    setFailure(undefined)
    const settle = (message?: string) => {
      if (requested.current !== chart) return
      setPendingChart(undefined)
      if (message !== undefined) setFailure({ chart, message })
    }
    onRepair({ chart, error }).then(
      () => settle(),
      (reason: unknown) => settle(messageOf(reason)),
    )
  }, [chart, error, onRepair])

  const pending = pendingChart === chart
  const failureText = failure?.chart === chart ? failure.message : undefined

  return (
    <Alert data-slot="diagram-error" className="my-4">
      {pending ? (
        <Spinner className="text-muted-foreground" />
      ) : (
        <TriangleAlertIcon className="text-destructive" />
      )}
      <AlertTitle>{pending ? 'Fixing diagram…' : "This diagram didn't render"}</AlertTitle>
      {pending ? null : (
        <>
          <AlertDescription>{summarizeDiagramError({ error })}</AlertDescription>
          <div className="col-start-2 mt-2 flex flex-col gap-2">
            <Collapsible open={sourceOpen} onOpenChange={setSourceOpen}>
              <div className="flex items-center gap-1.5">
                <CollapsibleTrigger render={<Button variant="outline" size="xs" />}>
                  {sourceOpen ? 'Hide source' : 'Show source'}
                </CollapsibleTrigger>
                <CodeBlockCopyButton value={chart} />
              </div>
              <CollapsibleContent>
                <pre className="mt-2 max-h-64 overflow-auto rounded-md bg-muted p-2 font-mono text-xs whitespace-pre-wrap text-foreground">
                  {chart}
                </pre>
              </CollapsibleContent>
            </Collapsible>
            {failureText === undefined ? null : (
              <p role="status" className="text-xs text-destructive">
                {failureText}
              </p>
            )}
          </div>
        </>
      )}
    </Alert>
  )
}
