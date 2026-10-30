import type { Meta, StoryObj } from '@storybook/react'

import { Chat, ChatItem } from './chat'
import { UserMessage } from './message'
import { SandboxBoot } from './sandbox-boot'

import {
  CLONE_FAILS_SNAPSHOT,
  EBootOutcome,
  READY_SNAPSHOT,
  RUNNING_SNAPSHOT,
  useBootSimulation,
} from './sandbox-boot.fixtures'

function BootInChat(props: Parameters<typeof SandboxBoot>[0]) {
  return (
    <Chat>
      <ChatItem id="u1">
        <UserMessage author="Dennis" timestamp="14:02">
          Add a Vercel AI Gateway row to the providers page, marked coming soon.
        </UserMessage>
      </ChatItem>
      <ChatItem id="boot">
        <SandboxBoot {...props} />
      </ChatItem>
    </Chat>
  )
}

function LiveBoot({ outcome }: { outcome: EBootOutcome }) {
  const { retry, ...boot } = useBootSimulation(outcome)
  return <BootInChat {...boot} onRetry={retry} />
}

const meta = {
  title: 'AI/Sandbox Boot',
  component: SandboxBoot,
  args: { ...RUNNING_SNAPSHOT },
  parameters: { layout: 'padded' },
  decorators: [
    (Story) => (
      <div className="w-[40rem] max-w-full">
        <Story />
      </div>
    ),
  ],
  render: (args) => <BootInChat {...args} />,
} satisfies Meta<typeof SandboxBoot>

export default meta

type Story = StoryObj<typeof meta>

export const Running: Story = {}

export const Ready: Story = {
  args: { ...READY_SNAPSHOT },
}

export const CloneFails: Story = {
  args: { ...CLONE_FAILS_SNAPSHOT, onRetry: () => {} },
}

export const Live: Story = {
  render: () => <LiveBoot outcome={EBootOutcome.Ready} />,
}

export const LiveCloneFails: Story = {
  render: () => <LiveBoot outcome={EBootOutcome.CloneFails} />,
}
