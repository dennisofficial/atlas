'use client'

import Link from 'next/link'
import { useCallback, useState } from 'react'
import { CheckIcon, CopyIcon } from 'lucide-react'

import { EMarkdownEditorVariant, MarkdownEditor } from '@dltech/atlas-ui/ai/markdown-editor'
import { Button } from '@dltech/atlas-ui/components/button'
import { cn } from '@dltech/atlas-ui/lib/utils'
import { GROUP_INSTRUCTION_CHAR_LIMIT } from '@dltech/atlas-wire/web'

import { SettingsCard, SettingsPage, SettingsSection } from '@/features/settings/settings-layout'
import { fetchInstructions } from '@/features/settings/data/personal/instructions-api'
import { QueryPage } from '@/features/settings/data/personal/query-boundary'
import { useSaveAction } from '@/features/settings/data/personal/use-save-action'
import {
  InstructionsActionsSkeleton,
  InstructionsSkeleton,
} from '@/features/settings/skeletons/library-skeletons'
import { useDraft } from '@/features/settings/use-draft'
import { EQueryState, useCloudQuery } from '@/lib/use-cloud-query'
import { useRouteParam } from '@/lib/route-param'

import {
  fetchGroupInstructions,
  saveGroupInstructions,
  type GroupInstructionsDoc,
} from './data/group-instructions-api'

const COPIED_RESET_MS = 1500

const PAGE_DESCRIPTION =
  "Loaded into every thread on every project of this group, after the personal instructions and before the repository's AGENTS.md files."

function CharCount({ length }: { length: number }) {
  const over = length - GROUP_INSTRUCTION_CHAR_LIMIT
  return (
    <span
      role="status"
      className={cn(
        'font-mono text-xs tabular-nums',
        over > 0 ? 'text-destructive' : 'text-muted-foreground',
      )}
    >
      {length.toLocaleString('en-US')} / {GROUP_INSTRUCTION_CHAR_LIMIT.toLocaleString('en-US')}
      {over > 0 ? ` · ${over.toLocaleString('en-US')} over` : null}
    </span>
  )
}

function InheritedPersonal() {
  const personal = useCloudQuery({ key: 'personal-instructions', load: fetchInstructions })
  if (personal.state !== EQueryState.Ready || personal.data.text.trim() === '') return null
  return (
    <SettingsSection
      title="From personal settings"
      description="Loaded first, before this group's text."
      actions={
        <Button
          variant="ghost"
          size="sm"
          nativeButton={false}
          render={<Link href="/settings/instructions" />}
        >
          Edit
        </Button>
      }
    >
      <SettingsCard>
        <div className="max-h-64 overflow-auto p-4 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
          {personal.data.text}
        </div>
      </SettingsCard>
    </SettingsSection>
  )
}

export function GroupInstructionsPage() {
  const groupId = useRouteParam('groupId')
  const query = useCloudQuery({
    key: `group-instructions:${groupId}`,
    load: () => fetchGroupInstructions(groupId),
  })
  return (
    <QueryPage
      query={query}
      title="Instructions"
      description={PAGE_DESCRIPTION}
      actions={<InstructionsActionsSkeleton />}
      skeleton={<InstructionsSkeleton />}
    >
      {(doc) => (
        <div className="flex flex-col gap-8">
          <GroupInstructionsEditor groupId={groupId} doc={doc} onSaved={query.reload} />
          <InheritedPersonal />
        </div>
      )}
    </QueryPage>
  )
}

function GroupInstructionsEditor({
  groupId,
  doc,
  onSaved,
}: {
  groupId: string
  doc: GroupInstructionsDoc
  onSaved: () => void
}) {
  const draft = useDraft(doc.content)
  const { saving, run } = useSaveAction()
  const [copied, setCopied] = useState(false)
  const overLimit = draft.value.length > GROUP_INSTRUCTION_CHAR_LIMIT

  const handleCopy = () => {
    void navigator.clipboard?.writeText(draft.value)
    setCopied(true)
    setTimeout(() => setCopied(false), COPIED_RESET_MS)
  }

  const { save: commitDraft } = draft
  const handleSave = useCallback(async () => {
    const saved = await run({
      work: () => saveGroupInstructions({ groupId, content: draft.value }),
      success: 'Instructions saved',
    })
    if (saved) {
      commitDraft()
      onSaved()
    }
  }, [run, groupId, draft.value, commitDraft, onSaved])

  return (
    <SettingsPage
      title="Instructions"
      description={PAGE_DESCRIPTION}
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
            disabled={!draft.dirty || overLimit || saving}
            onClick={() => void handleSave()}
          >
            Save
          </Button>
        </>
      }
    >
      <MarkdownEditor
        variant={EMarkdownEditorVariant.Document}
        ariaLabel="Group ATLAS.md"
        maxLength={GROUP_INSTRUCTION_CHAR_LIMIT}
        value={draft.value}
        onChange={draft.setValue}
      />
    </SettingsPage>
  )
}
