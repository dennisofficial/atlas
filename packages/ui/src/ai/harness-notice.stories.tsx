import type { Meta, StoryObj } from '@storybook/react'

import { ENoticeTone, HarnessNotice } from './harness-notice'

const meta = {
  title: 'AI/Harness Notice',
  component: HarnessNotice,
  args: { title: 'PR #12: merged', tone: ENoticeTone.Ok, emptyNote: 'no body' },
} satisfies Meta<typeof HarnessNotice>

export default meta
type Story = StoryObj<typeof meta>

export const Empty: Story = {}

export const Failed: Story = {
  args: {
    title: 'Shell exited with code 1',
    tone: ENoticeTone.Failed,
    body: 'error: build failed\n  at src/index.ts:4',
  },
}

export const Attention: Story = {
  args: { title: 'Sandbox is out of disk', tone: ENoticeTone.Attention },
}

export const Quiet: Story = {
  args: {
    title: 'Atlas noticed — nudge',
    tone: ENoticeTone.Quiet,
    body: 'Check the build before replying.',
  },
}

export const Context: Story = {
  args: {
    title: 'Loaded context',
    tone: ENoticeTone.Quiet,
    sections: [
      { id: 'a', label: 'AGENTS.md', content: 'Use bun.' },
      { id: 'b', label: 'memory', content: 'Old note', note: 'superseded' },
    ],
  },
}
