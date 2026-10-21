export enum ELogo {
  Wordmark = 'wordmark',
  Mark = 'mark',
}

export const SHIPPED_LOGO = ELogo.Mark

const listeners = new Set<() => void>()

let current: ELogo = SHIPPED_LOGO

let version = 0

export const subscribeLogo = (listener: () => void): (() => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export const logoVersion = (): number => version

export const logo = (): ELogo => current

export function applyLogo(next: ELogo): void {
  if (next === current) return
  current = next
  version += 1
  for (const listener of listeners) listener()
}

export const logoOf = (value: string): ELogo => {
  if (value === ELogo.Wordmark) return ELogo.Wordmark
  return ELogo.Mark
}
