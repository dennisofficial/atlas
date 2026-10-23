import type { Meta, StoryObj } from '@storybook/nextjs-vite'

import { AuthPreview } from './auth-preview'
import {
  EAuthScreen,
  EDeviceConfirmState,
  EDeviceResultState,
  ESignInContext,
  ESignInState,
} from './auth-route'
import { FULLSCREEN } from './story-kit'

type Args = Record<string, never>

const meta = {
  title: 'Views/Auth/Device login',
  parameters: FULLSCREEN,
} satisfies Meta<Args>

export default meta
type Story = StoryObj<Args>

export const EnterCode: Story = {
  render: () => <AuthPreview route={{ screen: EAuthScreen.DeviceEnter }} />,
}

export const Confirm: Story = {
  render: () => (
    <AuthPreview route={{ screen: EAuthScreen.DeviceConfirm, state: EDeviceConfirmState.Idle }} />
  ),
}

export const ConfirmBusy: Story = {
  render: () => (
    <AuthPreview route={{ screen: EAuthScreen.DeviceConfirm, state: EDeviceConfirmState.Busy }} />
  ),
}

export const Approved: Story = {
  render: () => (
    <AuthPreview route={{ screen: EAuthScreen.DeviceResult, state: EDeviceResultState.Approved }} />
  ),
}

export const Denied: Story = {
  render: () => (
    <AuthPreview route={{ screen: EAuthScreen.DeviceResult, state: EDeviceResultState.Denied }} />
  ),
}

export const ExpiredCode: Story = {
  render: () => (
    <AuthPreview route={{ screen: EAuthScreen.DeviceResult, state: EDeviceResultState.Expired }} />
  ),
}

export const SignedOut: Story = {
  render: () => (
    <AuthPreview
      route={{
        screen: EAuthScreen.SignIn,
        state: ESignInState.Idle,
        context: ESignInContext.Device,
      }}
    />
  ),
}
