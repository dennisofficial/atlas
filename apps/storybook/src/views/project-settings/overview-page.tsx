import { useState } from 'react'

import { Button } from '@dltech/atlas-ui/components/button'

import { PROJECT, type ProjectFixture } from '../../fixtures/project-settings'
import {
  ERowLayout,
  SettingsCard,
  SettingsPage,
  SettingsRow,
  UnsavedHint,
} from '../settings/settings-layout'
import { AdditionalRepositories } from './overview-additional-repos'
import { BranchPicker } from './overview-branch-picker'
import { DangerZone } from './overview-danger-zone'
import { draftsEqual, EOverviewPicker, repoSlug, type OverviewDraft } from './overview-model'
import { RepositoryCard } from './overview-repository-card'
import { ShipSelect } from './overview-ship-select'

export interface OverviewPageProps {
  initial?: ProjectFixture
  draftOverride?: Partial<OverviewDraft>
  openPicker?: EOverviewPicker
}

export function OverviewPage({ initial = PROJECT, draftOverride, openPicker }: OverviewPageProps) {
  const [saved, setSaved] = useState<OverviewDraft>(initial)
  const [draft, setDraft] = useState<OverviewDraft>({ ...initial, ...draftOverride })
  const dirty = !draftsEqual({ left: draft, right: saved })

  const update = (patch: Partial<OverviewDraft>) =>
    setDraft((current) => ({ ...current, ...patch }))

  const handleDiscard = () => setDraft(saved)
  const handleSave = () => setSaved(draft)

  return (
    <SettingsPage title="Overview" description="The repository threads work in, and how they ship.">
      <RepositoryCard repo={initial} />
      <SettingsCard
        footer={
          <>
            <UnsavedHint visible={dirty} />
            {dirty ? (
              <Button variant="ghost" size="sm" onClick={handleDiscard}>
                Discard
              </Button>
            ) : null}
            <Button size="sm" disabled={!dirty} onClick={handleSave}>
              Save
            </Button>
          </>
        }
      >
        <SettingsRow
          title="Base branch"
          htmlFor="project-base-branch"
          description="New threads branch from here. Pull requests target it."
        >
          <BranchPicker
            id="project-base-branch"
            defaultBranch={initial.defaultBranch}
            value={draft.baseBranch}
            onChange={(baseBranch) => update({ baseBranch })}
            defaultOpen={openPicker === EOverviewPicker.Branch}
          />
        </SettingsRow>
        <SettingsRow
          title="Ship behavior"
          htmlFor="project-ship"
          description="What happens when a thread finishes."
        >
          <ShipSelect
            id="project-ship"
            value={draft.shipBehavior}
            onChange={(shipBehavior) => update({ shipBehavior })}
          />
        </SettingsRow>
        <SettingsRow
          title="Additional repositories"
          description="Cloned next to the main repository, for threads that span repos."
          layout={ERowLayout.Stacked}
        >
          <AdditionalRepositories
            project={initial}
            repositories={draft.additionalRepositories}
            onChange={(additionalRepositories) => update({ additionalRepositories })}
            defaultOpen={openPicker === EOverviewPicker.Repository}
          />
        </SettingsRow>
      </SettingsCard>
      <DangerZone projectSlug={repoSlug(initial)} />
    </SettingsPage>
  )
}
