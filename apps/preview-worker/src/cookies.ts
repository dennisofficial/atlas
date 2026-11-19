const SAME_SITE_ATTRIBUTE = /^samesite\s*=/i
const CROSS_SITE = 'cross-site'
const DOCUMENT_DESTINATION = 'document'

export function isThirdPartyFrameRequest(request: Request): boolean {
  const site = request.headers.get('sec-fetch-site')
  const destination = request.headers.get('sec-fetch-dest')
  return site === CROSS_SITE && destination !== DOCUMENT_DESTINATION
}

export function rewriteSetCookie(cookie: string): string {
  const parts = cookie
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
  const [pair = '', ...attributes] = parts
  const kept = attributes.filter((attribute) => !SAME_SITE_ATTRIBUTE.test(attribute))
  const has = (name: string) => kept.some((attribute) => attribute.toLowerCase() === name)
  const rewritten = [pair, ...kept]
  if (!has('secure')) rewritten.push('Secure')
  if (!has('partitioned')) rewritten.push('Partitioned')
  rewritten.push('SameSite=None')
  return rewritten.join('; ')
}
