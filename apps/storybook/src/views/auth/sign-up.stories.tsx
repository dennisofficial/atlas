import type { Meta, StoryObj } from '@storybook/react-vite'

import { AuthPreview } from './auth-preview'
import { EAuthScreen, ESignUpState } from './auth-route'
import { FULLSCREEN, demoArgType } from './story-kit'

interface Args {
  demo: ESignUpState
}

const meta = {
  title: 'Views/Auth/Sign up',
  parameters: FULLSCREEN,
  args: { demo: ESignUpState.Idle },
  argTypes: {
    demo: demoArgType(Object.values(ESignUpState)),
  },
  render: ({ demo }) => <AuthPreview route={{ screen: EAuthScreen.SignUp, state: demo }} />,
} satisfies Meta<Args>

export default meta
type Story = StoryObj<typeof meta>

export const Idle: Story = {}
export const Busy: Story = { args: { demo: ESignUpState.Busy } }
export const EmailTaken: Story = { args: { demo: ESignUpState.Error } }
