'use client'

import { useState } from 'react'

import { Button } from '@dltech/atlas-ui/components/button'
import { Input } from '@dltech/atlas-ui/components/input'

import { QueryGate } from '@/features/settings/data/shared/query-gate'
import { runAction } from '@/features/settings/data/shared/run-action'

import { useProjectContext } from './data/project-context'
import {
  prCommentEditorChanges,
  prCommentEditorsOf,
  type PrCommentEditors,
} from './data/pr-comment-editors'
import { useProjectSettings } from './data/use-project-settings'
import {
  ERowLayout,
  SettingsCard,
  SettingsRow,
  SettingsSection,
  UnsavedHint,
} from './settings-layout'

const LOGIN_HINT = 'Comma-separated GitHub logins. A bot’s [bot] suffix is optional.'

function CommentEditorsForm({
  saved,
  onSave,
}: {
  saved: PrCommentEditors
  onSave: (draft: PrCommentEditors) => Promise<boolean>
}) {
  const [draft, setDraft] = useState(saved)
  const [saving, setSaving] = useState(false)
  const dirty = draft.muted !== saved.muted || draft.urgent !== saved.urgent
  const handleSave = async () => {
    setSaving(true)
    await onSave(draft)
    setSaving(false)
  }
  return (
    <SettingsCard
      footer={
        <>
          <UnsavedHint visible={dirty} />
          <Button size="sm" disabled={!dirty || saving} onClick={() => void handleSave()}>
            Save
          </Button>
        </>
      }
    >
      <SettingsRow
        title="Muted comment editors"
        htmlFor="pr-muted-editors"
        description={`Edits to pull request comments by these authors never reach a subscribed conversation. Status bots that rewrite one comment on every deploy belong here. ${LOGIN_HINT}`}
        layout={ERowLayout.Stacked}
      >
        <Input
          id="pr-muted-editors"
          spellCheck={false}
          autoComplete="off"
          className="font-mono text-xs md:text-xs"
          value={draft.muted}
          onChange={(event) => setDraft({ ...draft, muted: event.target.value })}
        />
      </SettingsRow>
      <SettingsRow
        title="Urgent comment editors"
        htmlFor="pr-urgent-editors"
        description={`Edits to pull request comments by these authors wake a subscribed conversation at once, instead of arriving with the next batch of routine updates. Use it for review bots that report by editing one comment. ${LOGIN_HINT}`}
        layout={ERowLayout.Stacked}
      >
        <Input
          id="pr-urgent-editors"
          spellCheck={false}
          autoComplete="off"
          placeholder="No urgent editors"
          className="font-mono text-xs md:text-xs"
          value={draft.urgent}
          onChange={(event) => setDraft({ ...draft, urgent: event.target.value })}
        />
      </SettingsRow>
    </SettingsCard>
  )
}

export function PullRequestsPage() {
  const { projectId } = useProjectContext()
  const { query, save } = useProjectSettings(projectId)
  return (
    <QueryGate query={query} label="pull request settings">
      {(values) => {
        const saved = prCommentEditorsOf(values)
        const handleSave = (draft: PrCommentEditors) =>
          runAction({
            work: () => save(prCommentEditorChanges({ draft })),
            success: 'Pull request settings saved',
          })
        return (
          <SettingsSection
            title="Comment edits"
            description="Which authors’ edits to pull request comments reach a conversation subscribed to the pull request, and how quickly."
          >
            <CommentEditorsForm
              key={`${saved.muted}|${saved.urgent}`}
              saved={saved}
              onSave={handleSave}
            />
          </SettingsSection>
        )
      }}
    </QueryGate>
  )
}
