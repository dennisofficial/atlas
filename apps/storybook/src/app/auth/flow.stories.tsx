import type { Meta, StoryObj } from '@storybook/nextjs-vite'

import { AuthFlow } from './auth-flow'
import { EAuthScreen, EHomeState } from './auth-route'
import { FULLSCREEN } from './story-kit'

type Args = Record<string, never>

const meta = {
  title: 'App/Auth/Flow',
  parameters: FULLSCREEN,
  render: () => <AuthFlow start={{ screen: EAuthScreen.Home, state: EHomeState.SignedOut }} />,
} satisfies Meta<Args>

export default meta
type Story = StoryObj<typeof meta>

export const Clickable: Story = {}
