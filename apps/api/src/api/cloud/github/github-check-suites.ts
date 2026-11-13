export const RUN_KEY_PREFIX = 'run:'
export const SUITE_KEY_PREFIX = 'suite:'

export function runOrderOfKey(checkKey: string): number | null {
  if (!checkKey.startsWith(RUN_KEY_PREFIX)) return null
  const id = Number(checkKey.slice(RUN_KEY_PREFIX.length))
  return Number.isSafeInteger(id) ? id : null
}
