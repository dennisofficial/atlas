import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'

import {
  InputOTP,
  InputOTPGroup,
  InputOTPSeparator,
  InputOTPSlot,
} from '@dltech/atlas-ui/components/input-otp'
import { Field, FieldDescription, FieldLabel } from '@dltech/atlas-ui/components/field'
import { Kbd } from '@dltech/atlas-ui/components/kbd'

import { cn } from '@dltech/atlas-ui/lib/utils'

import { CENTER_ROW, CENTER_SELF, CENTER_TEXT } from './auth-align'
import { SubmitButton } from './auth-controls'
import { AuthHeading } from './auth-heading'
import { formatDeviceCode } from './auth-format'
import { deviceStepHref } from './auth-paths'
import { EDeviceStep } from './auth-states'
import { AUTH_LOGIN_COMMAND } from './fixtures/auth'

const CODE_LENGTH = 8
const CODE_PATTERN = '^[a-zA-Z0-9]*$'
const SLOT_CLASS = 'h-11 w-9 font-mono text-lg font-medium uppercase sm:w-10'

const EXPIRED_CODE_PREFIX = '0000'

export function DeviceEnterScreen() {
  const router = useRouter()
  const [code, setCode] = useState('')
  const ready = code.length === CODE_LENGTH

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!ready) return
    const formatted = formatDeviceCode(code)
    if (formatted.startsWith(EXPIRED_CODE_PREFIX)) {
      router.push(deviceStepHref({ step: EDeviceStep.ExpiredCode }))
      return
    }
    router.push(deviceStepHref({ step: EDeviceStep.Confirm, code: formatted }))
  }

  return (
    <div className="flex flex-col gap-6">
      <AuthHeading
        title="Enter your device code"
        description={
          <>
            Run <Kbd className="pointer-events-auto font-mono">{AUTH_LOGIN_COMMAND}</Kbd> in your
            terminal and type the code it prints.
          </>
        }
      />
      <form onSubmit={handleSubmit}>
        <div className="flex flex-col gap-6">
          <Field>
            <FieldLabel htmlFor="device-code" className={cn(CENTER_SELF, CENTER_ROW)}>
              Device code
            </FieldLabel>
            <InputOTP
              id="device-code"
              maxLength={CODE_LENGTH}
              pattern={CODE_PATTERN}
              value={code}
              onChange={(value) => setCode(value.toUpperCase())}
              autoFocus
              containerClassName={cn('gap-2', CENTER_ROW)}
            >
              <InputOTPGroup>
                {[0, 1, 2, 3].map((index) => (
                  <InputOTPSlot key={index} index={index} className={SLOT_CLASS} />
                ))}
              </InputOTPGroup>
              <InputOTPSeparator />
              <InputOTPGroup>
                {[4, 5, 6, 7].map((index) => (
                  <InputOTPSlot key={index} index={index} className={SLOT_CLASS} />
                ))}
              </InputOTPGroup>
            </InputOTP>
            <FieldDescription className={CENTER_TEXT}>
              Eight characters, shown as XXXX-XXXX.
            </FieldDescription>
          </Field>
          <SubmitButton disabled={!ready}>Continue</SubmitButton>
        </div>
      </form>
    </div>
  )
}
