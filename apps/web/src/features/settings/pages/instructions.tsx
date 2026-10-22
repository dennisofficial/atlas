'use client'

import { useCallback, useState } from 'react'
import { CheckIcon, CopyIcon } from 'lucide-react'

import { Button } from '@dltech/atlas-ui/components/button'
import { Textarea } from '@dltech/atlas-ui/components/textarea'

import { useCloudQuery } from '@/lib/use-cloud-query'

import {
  fetchInstructions,
  saveInstructions,
  type InstructionsDoc,
} from '../data/personal/instructions-api'
import { QueryPage } from '../data/personal/query-boundary'
import { useSaveAction } from '../data/personal/use-save-action'
import { INSTRUCTIONS_CHAR_LIMIT } from '../fixtures/settings-agent'
import { Mono, SaveFooter, SettingsCard, SettingsPage } from '../settings-layout'
import { useDraft } from '../use-draft'

const COPIED_RESET_MS = 1500

export function InstructionsPage() {
  const query = useCloudQuery({ key: 'personal-instructions', load: fetchInstructions })
  return (
    <QueryPage query={query} title="Instructions" rows={1}>
      {(doc) => <InstructionsEditor doc={doc} onSaved={query.reload} />}
    </QueryPage>
  )
}

function InstructionsEditor({ doc, onSaved }: { doc: InstructionsDoc; onSaved: () => void }) {
  const draft = useDraft(doc.text)
  const { saving, run } = useSaveAction()
  const [copied, setCopied] = useState(false)
  const [revision, setRevision] = useState(doc.revision)
  const length = draft.value.length
  const overLimit = length > INSTRUCTIONS_CHAR_LIMIT

  const handleCopy = () => {
    void navigator.clipboard?.writeText(draft.value)
    setCopied(true)
    setTimeout(() => setCopied(false), COPIED_RESET_MS)
  }

  const { save: commitDraft } = draft
  const handleSave = useCallback(async () => {
    const saved = await run({
      work: async () => {
        const next = await saveInstructions({ text: draft.value, baseRevision: revision })
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
    <SettingsPage title="Instructions">
      <SettingsCard
        footer={
          <div className="flex w-full items-center justify-between gap-2">
            <Mono className={overLimit ? 'text-destructive' : 'text-muted-foreground'}>
              {length.toLocaleString('en-US')} / {INSTRUCTIONS_CHAR_LIMIT.toLocaleString('en-US')}{' '}
              characters
            </Mono>
            <div className="flex items-center gap-2">
              <SaveFooter
                dirty={draft.dirty && !overLimit && !saving}
                onDiscard={draft.discard}
                onSave={() => void handleSave()}
              />
            </div>
          </div>
        }
      >
        <div className="flex items-start justify-between gap-4 px-4 py-3.5">
          <div className="flex min-w-0 flex-col gap-0.5">
            <h2 className="font-mono text-sm font-medium">Global ATLAS.md</h2>
            <p className="text-sm text-muted-foreground">
              Loaded into every thread on every project, before the project&apos;s ATLAS.md,
              AGENTS.md and CLAUDE.md.
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Copy instructions"
            onClick={handleCopy}
          >
            {copied ? <CheckIcon /> : <CopyIcon />}
          </Button>
        </div>
        <div className="p-4">
          <Textarea
            aria-label="Global ATLAS.md"
            spellCheck={false}
            placeholder="Machine-wide rules for every repository."
            className="field-sizing-fixed h-96 resize-y font-mono text-xs leading-relaxed"
            value={draft.value}
            onChange={(event) => draft.setValue(event.target.value)}
          />
        </div>
      </SettingsCard>
    </SettingsPage>
  )
}
