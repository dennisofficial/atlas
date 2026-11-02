import type { ReactNode } from 'react'

import { CENTERED_PANEL } from './auth-align'
import { DeviceConfirmSkeleton, SetupSkeleton } from './auth-flow-skeletons'
import {
  ForgotPasswordSkeleton,
  ResetPasswordSkeleton,
  SignInSkeleton,
  SignUpSkeleton,
} from './auth-skeletons'
import { DeviceConfirm } from './device-confirm'
import { ForgotPasswordForm } from './forgot-password-form'
import { ResetPasswordForm } from './reset-password-form'
import { SetupDone } from './setup-done'
import { SignInForm } from './sign-in-form'
import { SignUpForm } from './sign-up-form'

function Pair({ loading, loaded }: { loading: ReactNode; loaded: ReactNode }) {
  return (
    <div className="grid grid-cols-2 gap-12 bg-background p-10">
      {[loading, loaded].map((panel, index) => (
        <div key={index} {...CENTERED_PANEL} className="group/auth mx-auto w-full max-w-sm">
          {panel}
        </div>
      ))}
    </div>
  )
}

const noop = () => {}

const meta = {
  title: 'App/Auth Skeletons',
  parameters: { layout: 'fullscreen', nextjs: { appDirectory: true } },
}

export default meta

export const SignIn = {
  render: () => <Pair loading={<SignInSkeleton />} loaded={<SignInForm />} />,
}
export const SignUp = {
  render: () => <Pair loading={<SignUpSkeleton />} loaded={<SignUpForm />} />,
}
export const ForgotPassword = {
  render: () => <Pair loading={<ForgotPasswordSkeleton />} loaded={<ForgotPasswordForm />} />,
}
export const ResetPassword = {
  parameters: {
    nextjs: { appDirectory: true, navigation: { query: { token: 'abc' } } },
  },
  render: () => <Pair loading={<ResetPasswordSkeleton />} loaded={<ResetPasswordForm />} />,
}
export const Setup = {
  render: () => <Pair loading={<SetupSkeleton />} loaded={<SetupDone />} />,
}
export const Device = {
  render: () => (
    <Pair
      loading={<DeviceConfirmSkeleton />}
      loaded={
        <DeviceConfirm
          code="ABCD-1234"
          email="ada@company.com"
          pending={null}
          error={null}
          onAct={noop}
          onSwitchAccount={noop}
        />
      }
    />
  ),
}
