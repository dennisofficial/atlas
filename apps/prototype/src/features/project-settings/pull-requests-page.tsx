'use client'

import { useState } from 'react'

import { Button } from '@dltech/atlas-ui/components/button'
import { Input } from '@dltech/atlas-ui/components/input'

import {
  ERowLayout,
  SettingsCard,
  SettingsRow,
  SettingsSection,
  UnsavedHint,
} from '../settings/settings-layout'

const LOGIN_HINT = 'Comma-separated GitHub logins. A bot’s [bot] suffix is optional.'
const DEFAULT_MUTED = 'vercel, github-actions, netlify, mintlify'

export function PullRequestsPage() {
  const [saved, setSaved] = useState({ muted: DEFAULT_MUTED, urgent: '' })
  const [draft, setDraft] = useState(saved)
  const dirty = draft.muted !== saved.muted || draft.urgent !== saved.urgent
  return (
    <SettingsSection
      title="Comment edits"
      description="Which authors’ edits to pull request comments reach a conversation subscribed to the pull request, and how quickly."
    >
      <SettingsCard
        footer={
          <>
            <UnsavedHint visible={dirty} />
            <Button size="sm" disabled={!dirty} onClick={() => setSaved(draft)}>
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
            placeholder="No urgent editors"
            className="font-mono text-xs md:text-xs"
            value={draft.urgent}
            onChange={(event) => setDraft({ ...draft, urgent: event.target.value })}
          />
        </SettingsRow>
      </SettingsCard>
    </SettingsSection>
  )
}
