const HOSTED_STREAM_URL = 'wss://agent.byatlas.io/stream'
const LOCAL_STREAM_URL = 'ws://localhost:10000/stream'

export function resolveStreamUrl(env: Record<string, string | undefined>): string {
  const configured = env.ATLAS_STREAM_URL
  if (configured !== undefined && configured.length > 0) return configured
  if (env.VERCEL_ENV === 'production' || env.VERCEL_ENV === 'preview') return HOSTED_STREAM_URL
  if (env.ATLAS_WEB_TARGET === 'desktop') return HOSTED_STREAM_URL
  return LOCAL_STREAM_URL
}
