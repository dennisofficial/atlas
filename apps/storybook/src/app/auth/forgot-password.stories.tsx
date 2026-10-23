import type { Meta, StoryObj } from '@storybook/nextjs-vite'

import { AuthPreview } from './auth-preview'
import { EAuthScreen, EForgotState } from './auth-route'
import { FULLSCREEN } from './story-kit'

type Args = Record<string, never>

const meta = {
  title: 'App/Auth/Forgot password',
  parameters: FULLSCREEN,
} satisfies Meta<Args>

export default meta
type Story = StoryObj<Args>

export const ForgotIdle: Story = {
  render: () => <AuthPreview route={{ screen: EAuthScreen.Forgot, state: EForgotState.Idle }} />,
}

export const ForgotSent: Story = {
  render: () => <AuthPreview route={{ screen: EAuthScreen.Forgot, state: EForgotState.Sent }} />,
}
