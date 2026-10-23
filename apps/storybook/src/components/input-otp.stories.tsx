import type { Meta, StoryObj } from '@storybook/nextjs-vite'

import {
  InputOTP,
  InputOTPGroup,
  InputOTPSeparator,
  InputOTPSlot,
} from '@dltech/atlas-ui/components/input-otp'

const meta = {
  title: 'Components/Input OTP',
} satisfies Meta

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => (
    <InputOTP maxLength={6}>
      <InputOTPGroup>
        <InputOTPSlot index={0} />
        <InputOTPSlot index={1} />
        <InputOTPSlot index={2} />
      </InputOTPGroup>
      <InputOTPSeparator />
      <InputOTPGroup>
        <InputOTPSlot index={3} />
        <InputOTPSlot index={4} />
        <InputOTPSlot index={5} />
      </InputOTPGroup>
    </InputOTP>
  ),
}

export const Prefilled: Story = {
  render: () => (
    <InputOTP maxLength={4} value="4821">
      <InputOTPGroup>
        {[0, 1, 2, 3].map((index) => (
          <InputOTPSlot key={index} index={index} />
        ))}
      </InputOTPGroup>
    </InputOTP>
  ),
}

export const Disabled: Story = {
  render: () => (
    <InputOTP maxLength={4} value="" disabled>
      <InputOTPGroup>
        {[0, 1, 2, 3].map((index) => (
          <InputOTPSlot key={index} index={index} />
        ))}
      </InputOTPGroup>
    </InputOTP>
  ),
}
