import type { Meta, StoryObj } from '@storybook/react-vite'

import { AuthPreview } from './auth-preview'
import { EAuthScreen, ESetupState } from './auth-route'
import { FULLSCREEN, demoArgType } from './story-kit'

interface Args {
  demo: ESetupState
}

const meta = {
  title: 'Views/Auth/Setup',
  parameters: FULLSCREEN,
  args: { demo: ESetupState.Workspace },
  argTypes: {
    demo: demoArgType(Object.values(ESetupState)),
  },
  render: ({ demo }) => <AuthPreview route={{ screen: EAuthScreen.Setup, state: demo }} />,
} satisfies Meta<Args>

export default meta
type Story = StoryObj<typeof meta>

export const CreateWorkspace: Story = {}
export const Done: Story = { args: { demo: ESetupState.Done } }
