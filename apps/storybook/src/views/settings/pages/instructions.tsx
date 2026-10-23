import { useState } from 'react'
import { CheckIcon, CopyIcon } from 'lucide-react'

import { EMarkdownEditorVariant, MarkdownEditor } from '@dltech/atlas-ui/ai/markdown-editor'
import { Button } from '@dltech/atlas-ui/components/button'
import { cn } from '@dltech/atlas-ui/lib/utils'

import { GLOBAL_INSTRUCTIONS_RICH, INSTRUCTIONS_CHAR_LIMIT } from '../../../fixtures/settings-agent'

const COPIED_RESET_MS = 1500

function formatCount(count: number) {
  return count.toLocaleString('en-US')
}

function CharCount({ length }: { length: number }) {
  const over = length - INSTRUCTIONS_CHAR_LIMIT
  return (
    <span
      role="status"
      className={cn(
        'font-mono text-xs tabular-nums',
        over > 0 ? 'text-destructive' : 'text-muted-foreground',
      )}
    >
      {formatCount(length)} / {formatCount(INSTRUCTIONS_CHAR_LIMIT)}
      {over > 0 ? ` · ${formatCount(over)} over` : null}
    </span>
  )
}

export function InstructionsPage({
  saved: initialSaved = GLOBAL_INSTRUCTIONS_RICH,
  initial = initialSaved,
}: {
  saved?: string
  initial?: string
}) {
  const [saved, setSaved] = useState(initialSaved)
  const [value, setValue] = useState(initial)
  const [copied, setCopied] = useState(false)
  const dirty = value !== saved
  const overLimit = value.length > INSTRUCTIONS_CHAR_LIMIT

  const handleCopy = () => {
    void navigator.clipboard?.writeText(value)
    setCopied(true)
    setTimeout(() => setCopied(false), COPIED_RESET_MS)
  }
  const handleDiscard = () => setValue(saved)
  const handleSave = () => setSaved(value)

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-1">
        <div className="flex min-h-7 items-center justify-between gap-4">
          <h1 className="text-lg font-semibold">Instructions</h1>
          <div className="flex shrink-0 items-center gap-2">
            {dirty ? <span className="text-sm text-muted-foreground">Unsaved changes</span> : null}
            {dirty ? (
              <Button variant="ghost" size="sm" onClick={handleDiscard}>
                Discard
              </Button>
            ) : null}
            <CharCount length={value.length} />
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Copy instructions"
              onClick={handleCopy}
            >
              {copied ? <CheckIcon /> : <CopyIcon />}
            </Button>
            <Button size="sm" disabled={!dirty || overLimit} onClick={handleSave}>
              Save
            </Button>
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          Loaded into every thread, before the project's ATLAS.md, AGENTS.md and CLAUDE.md.
        </p>
      </header>
      <MarkdownEditor
        variant={EMarkdownEditorVariant.Document}
        ariaLabel="Global ATLAS.md"
        maxLength={INSTRUCTIONS_CHAR_LIMIT}
        value={value}
        onChange={setValue}
      />
    </div>
  )
}
