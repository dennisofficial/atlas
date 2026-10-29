import type { ThreadId } from '../events/ids'
import { VITE_ALLOWED_HOSTS_ENV } from './declaration'

export function serviceEnv({
  port,
  threadId,
  publicUrl,
}: {
  port: number
  threadId: ThreadId
  publicUrl?: string | undefined
}): Record<string, string> {
  const env: Record<string, string> = { PORT: String(port), ATLAS_THREAD_ID: threadId }
  if (publicUrl === undefined) return env

  env.PUBLIC_URL = publicUrl
  env[VITE_ALLOWED_HOSTS_ENV] = new URL(publicUrl).hostname
  return env
}
