import type { Meta, StoryObj } from '@storybook/nextjs-vite'

import { AuthPreview } from './auth-preview'
import { EAuthScreen, EResetState } from './auth-route'
import { FULLSCREEN } from './story-kit'

type Args = Record<string, never>

const meta = {
  title: 'App/Auth/Reset password',
  parameters: FULLSCREEN,
} satisfies Meta<Args>

export default meta
type Story = StoryObj<Args>

export const ResetIdle: Story = {
  render: () => <AuthPreview route={{ screen: EAuthScreen.Reset, state: EResetState.Idle }} />,
}

export const ResetMismatch: Story = {
  render: () => <AuthPreview route={{ screen: EAuthScreen.Reset, state: EResetState.Mismatch }} />,
}

export const ResetSuccess: Story = {
  render: () => <AuthPreview route={{ screen: EAuthScreen.Reset, state: EResetState.Success }} />,
}

export const ResetExpired: Story = {
  render: () => <AuthPreview route={{ screen: EAuthScreen.Reset, state: EResetState.Expired }} />,
}
