import { createHmac } from 'node:crypto'
import { API_PROVISIONED_ENV, POD_TELEMETRY_IDENTITY_ENV } from '@dltech/atlas-wire'

const UUID_BYTES = 16
const VERSION_BYTE = 6
const VARIANT_BYTE = 8

export const podTelemetryIdentity = (args: { userId: string; pepper: string }): string => {
  const bytes = Uint8Array.from(
    createHmac('sha256', args.pepper).update(args.userId).digest().subarray(0, UUID_BYTES),
  )
  bytes[VERSION_BYTE] = ((bytes[VERSION_BYTE] ?? 0) & 0x0f) | 0x40
  bytes[VARIANT_BYTE] = ((bytes[VARIANT_BYTE] ?? 0) & 0x3f) | 0x80
  const hex = Buffer.from(bytes).toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export const apiProvisionedEnvironment = (args: {
  userId: string | undefined
  pepper: string | undefined
}): Record<string, string> => ({
  [API_PROVISIONED_ENV]: '1',
  ...(args.userId === undefined || args.pepper === undefined
    ? {}
    : {
        [POD_TELEMETRY_IDENTITY_ENV]: podTelemetryIdentity({
          userId: args.userId,
          pepper: args.pepper,
        }),
      }),
})
