const SAME_SITE_ATTRIBUTE = /^samesite\s*=/i

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
