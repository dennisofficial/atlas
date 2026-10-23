import type { Meta, StoryObj } from '@storybook/react-vite'

import { EProjectSettingsPage, EShipBehavior } from '../../fixtures/project-settings'
import { EOverviewPicker } from './overview-model'
import { OverviewPage, type OverviewPageProps } from './overview-page'
import { ProjectSettingsShell } from './project-settings-shell'

const meta = {
  title: 'Views/Project Settings/Overview',
  parameters: { layout: 'fullscreen' },
} satisfies Meta

export default meta

type Story = StoryObj<typeof meta>

function renderOverview(props: OverviewPageProps = {}) {
  return (
    <ProjectSettingsShell active={EProjectSettingsPage.Overview}>
      <OverviewPage {...props} />
    </ProjectSettingsShell>
  )
}

export const Default: Story = {
  render: () => renderOverview(),
}

export const Dirty: Story = {
  render: () =>
    renderOverview({
      draftOverride: {
        baseBranch: 'release/0.9',
        shipBehavior: EShipBehavior.Push,
        additionalRepositories: ['dennisofficial/atlas-docs', 'dltech/design-tokens'],
      },
    }),
}

export const BranchPickerOpen: Story = {
  render: () => renderOverview({ openPicker: EOverviewPicker.Branch }),
}

export const AddRepositoryOpen: Story = {
  render: () => renderOverview({ openPicker: EOverviewPicker.Repository }),
}
