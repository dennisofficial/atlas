import type { Meta, StoryObj } from '@storybook/react-vite'

import { NewThreadView } from './new-thread/new-thread-view'
import { EFirstMessage, ENewThreadOutcome, EPodProgress } from './new-thread/new-thread-types'

const meta = {
  title: 'Views/App/NewThread',
  component: NewThreadView,
  parameters: { layout: 'fullscreen' },
  argTypes: {
    outcome: { control: 'select', options: Object.values(ENewThreadOutcome) },
  },
} satisfies Meta<typeof NewThreadView>

export default meta
type Story = StoryObj<typeof meta>

export const Draft: Story = {}

export const TakenBack: Story = { args: { initialPod: EPodProgress.WaitingForPod } }

export const PodReadyNoMessage: Story = { args: { initialPod: EPodProgress.Ready } }

export const WaitingForPod: Story = {
  args: { initialPod: EPodProgress.WaitingForPod, initialMessage: EFirstMessage.Pending },
}

export const NoProject: Story = {
  args: {
    initialPod: EPodProgress.WaitingForPod,
    initialMessage: EFirstMessage.Pending,
    initialProjectId: null,
  },
}

export const SettingUpWorkspace: Story = {
  args: { initialPod: EPodProgress.SettingUpWorkspace, initialMessage: EFirstMessage.Pending },
}

export const Streaming: Story = {
  args: { initialPod: EPodProgress.Ready, initialMessage: EFirstMessage.Running },
}

export const FirstTurnDone: Story = {
  args: { initialPod: EPodProgress.Ready, initialMessage: EFirstMessage.Done },
}

export const NoVercelToken: Story = {
  args: { initialPod: EPodProgress.NoVercelToken, initialMessage: EFirstMessage.Pending },
}

export const ProvisionFailed: Story = {
  args: { initialPod: EPodProgress.ProvisionFailed, initialMessage: EFirstMessage.Pending },
}

export const Interactive: Story = { args: { autoRun: true, outcome: ENewThreadOutcome.Success } }
