const PRODUCTION_API_ORIGIN = 'https://api.byatlas.io'
const LOCAL_API_ORIGIN = 'http://localhost:3400'

export function resolveApiOrigin(env: Record<string, string | undefined>): string {
  const configured = env.ATLAS_API_ORIGIN
  if (configured !== undefined && configured.length > 0) return configured
  if (env.VERCEL_ENV === 'production' || env.VERCEL_ENV === 'preview') return PRODUCTION_API_ORIGIN
  return LOCAL_API_ORIGIN
}
