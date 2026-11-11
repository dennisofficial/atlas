const normaliseOrigin = (origin: string): string => origin.trim().replace(/\/+$/, '').toLowerCase()

export const missingTrustedOrigins = ({
  trustedOrigins,
  webOrigin,
}: {
  trustedOrigins: readonly string[]
  webOrigin: string
}): string[] => {
  const required = normaliseOrigin(webOrigin)
  if (required.length === 0) return []
  const trusted = new Set(trustedOrigins.map(normaliseOrigin))
  return trusted.has(required) ? [] : [webOrigin.trim()]
}
