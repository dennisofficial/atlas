import type { IPushApi } from './push-api'
import {
  EPushRegistrationStatus,
  EPushStep,
  type TPushRegistration,
  type TPushTokenResult,
} from './push-registration'

export const PUSH_DEVICE_LABEL = 'iPhone'

export const PUSH_STEP_TIMEOUT_MS = 20_000

type TSettled<T> = { ok: true; value: T } | { ok: false; message: string }

const messageOfError = (error: unknown): string =>
  error instanceof Error && error.message.length > 0 ? error.message : String(error)

const settle = async <T>(args: {
  run: () => Promise<T>
  timeoutMs: number
}): Promise<TSettled<T>> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<TSettled<T>>((resolve) => {
    timer = setTimeout(
      () => resolve({ ok: false, message: `no answer after ${args.timeoutMs / 1000} s` }),
      args.timeoutMs,
    )
  })
  const attempt = Promise.resolve()
    .then(args.run)
    .then(
      (value): TSettled<T> => ({ ok: true, value }),
      (error: unknown): TSettled<T> => ({ ok: false, message: messageOfError(error) }),
    )
  try {
    return await Promise.race([attempt, timeout])
  } finally {
    clearTimeout(timer)
  }
}

const failedAt = (step: EPushStep, message: string): TPushRegistration => ({
  status: EPushRegistrationStatus.Failed,
  step,
  message,
})

export const registerPushDevice = async (args: {
  pushApi: IPushApi
  clientId: () => Promise<string>
  pushToken: () => Promise<TPushTokenResult>
  timeoutMs?: number
}): Promise<TPushRegistration> => {
  const timeoutMs = args.timeoutMs ?? PUSH_STEP_TIMEOUT_MS
  const clientId = await settle({ run: args.clientId, timeoutMs })
  if (!clientId.ok) return failedAt(EPushStep.Install, clientId.message)
  const token = await settle({ run: args.pushToken, timeoutMs })
  if (!token.ok) return failedAt(EPushStep.Token, token.message)
  if (token.value.status === 'skipped') {
    return { status: EPushRegistrationStatus.Skipped, reason: token.value.reason }
  }
  const pushToken = token.value.token
  const device = await settle({
    run: () =>
      args.pushApi.register({
        token: pushToken,
        clientId: clientId.value,
        label: PUSH_DEVICE_LABEL,
      }),
    timeoutMs,
  })
  if (!device.ok) return failedAt(EPushStep.Register, device.message)
  return { status: EPushRegistrationStatus.Registered, deviceId: device.value.id }
}
