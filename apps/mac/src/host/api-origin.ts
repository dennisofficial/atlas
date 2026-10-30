const PRODUCTION_API_ORIGIN = 'https://api.byatlas.io'

export function resolveApiOrigin(env: Record<string, string | undefined>): string {
  const configured = env.ATLAS_API_ORIGIN
  return configured !== undefined && configured.length > 0 ? configured : PRODUCTION_API_ORIGIN
}

const PRODUCTION_WEB_ORIGIN = 'https://byatlas.io'

export function resolveWebOrigin(env: Record<string, string | undefined>): string {
  const configured = env.ATLAS_WEB_ORIGIN
  return configured !== undefined && configured.length > 0 ? configured : PRODUCTION_WEB_ORIGIN
}
