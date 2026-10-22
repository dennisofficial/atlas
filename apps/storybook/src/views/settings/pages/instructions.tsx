import { useState } from 'react'
import { CheckIcon, CopyIcon } from 'lucide-react'

import { Button } from '@dltech/atlas-ui/components/button'
import { Textarea } from '@dltech/atlas-ui/components/textarea'

import { GLOBAL_INSTRUCTIONS, INSTRUCTIONS_CHAR_LIMIT } from '../../../fixtures/settings-agent'
import { Mono, SaveFooter, SettingsCard, SettingsPage } from '../settings-layout'
import { useDraft } from '../use-draft'

const COPIED_RESET_MS = 1500

export function InstructionsPage() {
  const draft = useDraft(GLOBAL_INSTRUCTIONS)
  const [copied, setCopied] = useState(false)
  const length = draft.value.length
  const overLimit = length > INSTRUCTIONS_CHAR_LIMIT

  const handleCopy = () => {
    void navigator.clipboard?.writeText(draft.value)
    setCopied(true)
    setTimeout(() => setCopied(false), COPIED_RESET_MS)
  }

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
              <SaveFooter dirty={draft.dirty} onDiscard={draft.discard} onSave={draft.save} />
            </div>
          </div>
        }
      >
        <div className="flex items-start justify-between gap-4 px-4 py-3.5">
          <div className="flex min-w-0 flex-col gap-0.5">
            <h2 className="font-mono text-sm font-medium">Global ATLAS.md</h2>
            <p className="text-sm text-muted-foreground">
              Loaded into every thread on every project, before the project's ATLAS.md, AGENTS.md
              and CLAUDE.md.
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
            className="field-sizing-fixed h-96 resize-y font-mono text-xs leading-relaxed"
            value={draft.value}
            onChange={(event) => draft.setValue(event.target.value)}
          />
        </div>
      </SettingsCard>
    </SettingsPage>
  )
}
