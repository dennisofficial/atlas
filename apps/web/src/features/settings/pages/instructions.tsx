'use client'

import { useCallback, useState } from 'react'
import { CheckIcon, CopyIcon } from 'lucide-react'

import { EMarkdownEditorVariant, MarkdownEditor } from '@dltech/atlas-ui/ai/markdown-editor'
import {
  INSTRUCTIONS_DESCRIPTION,
  canSaveInstructions,
  charCountOf,
} from '@dltech/atlas-client/settings'
import { Button } from '@dltech/atlas-ui/components/button'
import { cn } from '@dltech/atlas-ui/lib/utils'

import { useCloudQuery } from '@/lib/use-cloud-query'

import {
  fetchInstructions,
  saveInstructions,
  type InstructionsDoc,
} from '../data/personal/instructions-api'
import { QueryPage } from '../data/personal/query-boundary'
import { InstructionsActionsSkeleton, InstructionsSkeleton } from '../skeletons/library-skeletons'
import { useSaveAction } from '../data/personal/use-save-action'
import { INSTRUCTIONS_CHAR_LIMIT } from '../fixtures/settings-agent'
import { SettingsPage } from '../settings-layout'
import { useDraft } from '../use-draft'

const COPIED_RESET_MS = 1500

function CharCount({ length }: { length: number }) {
  const count = charCountOf({ length, limit: INSTRUCTIONS_CHAR_LIMIT })
  return (
    <span
      role="status"
      className={cn(
        'font-mono text-xs tabular-nums',
        count.over ? 'text-destructive' : 'text-muted-foreground',
      )}
    >
      {count.text}
    </span>
  )
}

export function InstructionsPage() {
  const query = useCloudQuery({
    key: 'personal-instructions',
    load: fetchInstructions,
  })
  return (
    <QueryPage
      query={query}
      title="Instructions"
      actions={<InstructionsActionsSkeleton />}
      skeleton={<InstructionsSkeleton />}
    >
      {(doc) => <InstructionsEditor doc={doc} onSaved={query.reload} />}
    </QueryPage>
  )
}

function InstructionsEditor({ doc, onSaved }: { doc: InstructionsDoc; onSaved: () => void }) {
  const draft = useDraft(doc.text)
  const { saving, run } = useSaveAction()
  const [copied, setCopied] = useState(false)
  const [revision, setRevision] = useState(doc.revision)

  const handleCopy = () => {
    void navigator.clipboard?.writeText(draft.value)
    setCopied(true)
    setTimeout(() => setCopied(false), COPIED_RESET_MS)
  }

  const { save: commitDraft } = draft
  const handleSave = useCallback(async () => {
    const saved = await run({
      work: async () => {
        const next = await saveInstructions({
          text: draft.value,
          baseRevision: revision,
        })
        setRevision(next.revision)
      },
      success: 'Instructions saved',
    })
    if (saved) {
      commitDraft()
      onSaved()
    }
  }, [run, draft.value, revision, commitDraft, onSaved])

  return (
    <SettingsPage
      title="Instructions"
      description={INSTRUCTIONS_DESCRIPTION}
      actions={
        <>
          <CharCount length={draft.value.length} />
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Copy instructions"
            onClick={handleCopy}
          >
            {copied ? <CheckIcon /> : <CopyIcon />}
          </Button>
          {draft.dirty ? (
            <Button variant="ghost" size="sm" onClick={draft.discard}>
              Discard
            </Button>
          ) : null}
          <Button
            size="sm"
            disabled={
              !canSaveInstructions({
                dirty: draft.dirty,
                length: draft.value.length,
                limit: INSTRUCTIONS_CHAR_LIMIT,
                saving,
              })
            }
            onClick={() => void handleSave()}
          >
            Save
          </Button>
        </>
      }
    >
      <MarkdownEditor
        variant={EMarkdownEditorVariant.Document}
        ariaLabel="Global ATLAS.md"
        maxLength={INSTRUCTIONS_CHAR_LIMIT}
        value={draft.value}
        onChange={draft.setValue}
      />
    </SettingsPage>
  )
}
