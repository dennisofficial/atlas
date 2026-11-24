const KNOWN_PLANS: Record<string, string> = {
  max: 'Max',
  pro: 'Pro',
  plus: 'Plus',
  team: 'Team',
  enterprise: 'Enterprise',
}

const BUSINESS = 'business'
const BUSINESS_LABEL = 'Business'

const titleCaseOf = (word: string): string =>
  word === '' ? '' : `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`

export function planNameOf(subscription: string | null | undefined): string | null {
  const raw = (subscription ?? '').trim()
  if (raw === '') return null
  const normalized = raw.toLowerCase()
  if (normalized.includes(BUSINESS)) return BUSINESS_LABEL
  const known = KNOWN_PLANS[normalized]
  if (known !== undefined) return known
  return raw.split('_').map(titleCaseOf).join(' ')
}
