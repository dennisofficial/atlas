'use client'

import { useState } from 'react'
import { SparklesIcon, TriangleAlertIcon } from 'lucide-react'

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

function messageOf(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}

export function DiagramError({ chart, error, onRepair }: DiagramErrorProps) {
  const [sourceOpen, setSourceOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [failure, setFailure] = useState<string>()

  const handleRepair = async () => {
    if (onRepair === undefined) return
    setPending(true)
    setFailure(undefined)
    try {
      await onRepair({ chart, error })
    } catch (reason) {
      setFailure(messageOf(reason))
    } finally {
      setPending(false)
    }
  }

  return (
    <Alert data-slot="diagram-error" className="my-4">
      <TriangleAlertIcon className="text-destructive" />
      <AlertTitle>This diagram didn&apos;t render</AlertTitle>
      <AlertDescription>{summarizeDiagramError({ error })}</AlertDescription>
      <div className="col-start-2 mt-2 flex flex-col gap-2">
        <Collapsible open={sourceOpen} onOpenChange={setSourceOpen}>
          <div className="flex items-center gap-1.5">
            <CollapsibleTrigger render={<Button variant="outline" size="xs" />}>
              {sourceOpen ? 'Hide source' : 'Show source'}
            </CollapsibleTrigger>
            <CodeBlockCopyButton value={chart} />
            {onRepair === undefined ? null : (
              <Button size="xs" disabled={pending} onClick={handleRepair}>
                {pending ? <Spinner /> : <SparklesIcon />}
                {pending ? 'Fixing…' : 'Fix diagram'}
              </Button>
            )}
          </div>
          <CollapsibleContent>
            <pre className="mt-2 max-h-64 overflow-auto rounded-md bg-muted p-2 font-mono text-xs whitespace-pre-wrap text-foreground">
              {chart}
            </pre>
          </CollapsibleContent>
        </Collapsible>
        {failure === undefined ? null : (
          <p role="status" className="text-xs text-destructive">
            {failure}
          </p>
        )}
      </div>
    </Alert>
  )
}
