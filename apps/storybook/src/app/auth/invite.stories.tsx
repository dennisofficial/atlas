import type { Meta, StoryObj } from '@storybook/nextjs-vite'

import { AuthPreview } from './auth-preview'
import { EAuthScreen, EInviteState } from './auth-route'
import { FULLSCREEN, demoArgType } from './story-kit'

interface Args {
  demo: EInviteState
}

const meta = {
  title: 'App/Auth/Invite',
  parameters: FULLSCREEN,
  args: { demo: EInviteState.SignedIn },
  argTypes: {
    demo: demoArgType(Object.values(EInviteState)),
  },
  render: ({ demo }) => <AuthPreview route={{ screen: EAuthScreen.Invite, state: demo }} />,
} satisfies Meta<Args>

export default meta
type Story = StoryObj<typeof meta>

export const SignedIn: Story = {}
export const SignedOut: Story = { args: { demo: EInviteState.SignedOut } }
export const Expired: Story = { args: { demo: EInviteState.Expired } }
