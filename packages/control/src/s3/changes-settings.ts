export interface ChangesS3Settings {
  endpoint: string
  region: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
}

export type ChangesSettings = { settings: ChangesS3Settings; prefix: string }

export class ChangeStorageMissingError extends Error {}

const requiredOf = (env: Record<string, string | undefined>, key: string): string => {
  const value = env[key]
  if (!value) throw new ChangeStorageMissingError(`change storage is missing ${key}`)
  return value
}

export const changesSettingsOf = (env: Record<string, string | undefined>): ChangesSettings => {
  const bucket = env['CHANGES_S3_BUCKET'] ?? env['ARTIFACT_S3_BUCKET']
  if (!bucket) throw new ChangeStorageMissingError('change storage is missing CHANGES_S3_BUCKET')

  return {
    settings: {
      endpoint: requiredOf(env, 'ARTIFACT_S3_ENDPOINT'),
      region: requiredOf(env, 'ARTIFACT_S3_REGION'),
      bucket,
      accessKeyId: requiredOf(env, 'ARTIFACT_S3_ACCESS_KEY_ID'),
      secretAccessKey: requiredOf(env, 'ARTIFACT_S3_SECRET_ACCESS_KEY'),
    },
    prefix: env['CHANGES_S3_PREFIX'] ?? 'worktree-changes',
  }
}
