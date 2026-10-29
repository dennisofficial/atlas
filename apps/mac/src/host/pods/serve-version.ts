export interface IServeVersionInput {
  envVersion?: string | undefined
  channel: string
  appVersion: string
}

const DEV_CHANNEL = 'dev'

export function resolveServeVersion({
  envVersion,
  channel,
  appVersion,
}: IServeVersionInput): string | undefined {
  if (envVersion !== undefined && envVersion.length > 0) return envVersion
  if (channel === DEV_CHANNEL) return undefined
  if (appVersion.length === 0) {
    throw new Error(
      `Release build (channel "${channel}") has no app version; refusing to boot pods on serve "latest"`,
    )
  }
  return appVersion
}
