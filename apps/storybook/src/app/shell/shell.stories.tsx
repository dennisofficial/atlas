import type { Meta, StoryObj } from '@storybook/nextjs-vite'

import { AppShell } from './app-shell'

const meta = {
  title: 'App/Shell',
  component: AppShell,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof AppShell>

export default meta
type Story = StoryObj<typeof meta>

export const Home: Story = {}

export const ThreadHoverCard: Story = {
  args: { demo: { threadCardId: 'thr-snapshots' } },
}

export const ProjectHoverCard: Story = {
  args: { demo: { projectCardId: 'rs-crm' } },
}

export const ArchivedThread: Story = {
  args: { demo: { archivedThreadIds: ['thr-wire-zod'], archivedBucketOpen: true } },
}

export const AccountMenu: Story = {
  args: { demo: { accountMenuOpen: true } },
}

export const SidebarCollapsed: Story = {
  args: { defaultOpen: false },
}
