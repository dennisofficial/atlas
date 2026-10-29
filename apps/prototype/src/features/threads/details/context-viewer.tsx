import { ArrowLeftIcon, CheckIcon, CopyIcon } from 'lucide-react'
import { useEffect, useState } from 'react'

import { MessageResponse } from '@dltech/atlas-ui/ai/message-response'
import { Button } from '@dltech/atlas-ui/components/button'

import { CONTEXT_TREE } from './details-fixtures'
import { findContextNode } from './details-model'

const MARKDOWN_PATH = /\.(md|markdown|mdx)$/i

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return undefined
    const timeout = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(timeout)
  }, [copied])
  const handleCopy = () => {
    navigator.clipboard
      .writeText(text)
      .then(() => setCopied(true))
      .catch(() => undefined)
  }
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={copied ? 'Copied' : 'Copy content'}
      onClick={handleCopy}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
    </Button>
  )
}

export function ContextViewer(props: { path: string; onBack: () => void }) {
  const { path } = props
  const content = findContextNode(CONTEXT_TREE, path)?.content

  return (
    <section aria-label="Context file" className="flex min-h-0 flex-1 flex-col">
      <header className="flex shrink-0 items-center gap-2 border-b px-3 py-2">
        <Button variant="ghost" size="sm" aria-label="Back" onClick={props.onBack}>
          <ArrowLeftIcon />
          Back
        </Button>
        <p className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground" title={path}>
          {path}
        </p>
        {content === undefined ? null : <CopyButton text={content} />}
      </header>
      <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col gap-2 overflow-auto px-4 py-6">
        {content === undefined ? (
          <p className="text-sm text-muted-foreground">File unavailable</p>
        ) : MARKDOWN_PATH.test(path) ? (
          <MessageResponse>{content}</MessageResponse>
        ) : (
          <pre className="font-mono text-sm whitespace-pre-wrap">{content}</pre>
        )}
      </div>
    </section>
  )
}
