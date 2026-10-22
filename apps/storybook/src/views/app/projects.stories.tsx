import type { Meta, StoryObj } from '@storybook/react-vite'

import { AppShell, EAppNav } from './app-shell'
import { ProjectsView, type ProjectsViewProps } from './projects/projects-view'

function ProjectsPage(props: ProjectsViewProps) {
  return (
    <AppShell activeNav={EAppNav.Projects}>
      <ProjectsView {...props} />
    </AppShell>
  )
}

const meta = {
  title: 'Views/App/Projects',
  component: ProjectsPage,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof ProjectsPage>

export default meta
type Story = StoryObj<typeof meta>

export const Personal: Story = { args: { initialOwnerId: 'dennisofficial' } }

export const Workspace: Story = { args: { initialOwnerId: 'compai' } }

export const All: Story = { args: { initialOwnerId: null } }
