import { createHash } from 'node:crypto'

const DRIVE_NAME_CAP = 60

const sanitize = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

const disambiguatorOf = (value: string): string =>
  createHash('sha256').update(value).digest('hex').slice(0, 6)

export function driveNameFor(args: { repo: string; number: number }): string {
  const full = `factory-${args.repo}-${args.number}`
  const name = sanitize(full)
  if (name.length <= DRIVE_NAME_CAP) return name
  const suffix = `-${disambiguatorOf(full)}`
  return `${name.slice(0, DRIVE_NAME_CAP - suffix.length).replace(/-+$/, '')}${suffix}`
}

/** Intakes that carry no ticket number yet (a Linear intake, later) fall back to the item id. */
export function fallbackDriveNameFor(args: { workItemId: string }): string {
  return sanitize(`factory-${args.workItemId}`)
}

const ISSUE_EXTERNAL_ID = /^(.+)#(\d+)$/

export function issueNumberOf(externalId: string): number | null {
  const match = ISSUE_EXTERNAL_ID.exec(externalId)
  return match === null ? null : Number(match[2])
}
