import type { Meta, StoryObj } from '@storybook/react-vite'

import { AuthPreview } from './auth-preview'
import { EAuthScreen, ESignInContext, ESignInState } from './auth-route'
import { FULLSCREEN, demoArgType } from './story-kit'

interface Args {
  demo: ESignInState
  context: ESignInContext
}

const meta = {
  title: 'Views/Auth/Sign in',
  parameters: FULLSCREEN,
  args: {
    demo: ESignInState.Idle,
    context: ESignInContext.Default,
  },
  argTypes: {
    demo: demoArgType(Object.values(ESignInState)),
    context: demoArgType(Object.values(ESignInContext)),
  },
  render: ({ demo, context }) => (
    <AuthPreview route={{ screen: EAuthScreen.SignIn, state: demo, context }} />
  ),
} satisfies Meta<Args>

export default meta
type Story = StoryObj<typeof meta>

export const Idle: Story = {}
export const Busy: Story = { args: { demo: ESignInState.Busy } }
export const Error: Story = { args: { demo: ESignInState.Error } }
export const GoogleError: Story = { args: { demo: ESignInState.GoogleError } }
export const ForDevice: Story = { args: { context: ESignInContext.Device } }
export const ForInvitation: Story = { args: { context: ESignInContext.Invite } }
