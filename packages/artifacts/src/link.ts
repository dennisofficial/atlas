import { ArtifactSpecError, SPEC_FILE_NAME } from './spec'
import { assertSubdomain, isSubdomain, type Subdomain } from './subdomain'

export const LINK_FIELD = 'subdomain'

const isJsonObject = (raw: unknown): raw is Record<string, unknown> =>
  typeof raw === 'object' && raw !== null && !Array.isArray(raw)

export function linkedSubdomainOf(raw: unknown): Subdomain | null {
  if (!isJsonObject(raw) || !(LINK_FIELD in raw)) return null
  const value = raw[LINK_FIELD]
  if (typeof value !== 'string' || !isSubdomain(value)) {
    throw new ArtifactSpecError(
      `${LINK_FIELD}: ${JSON.stringify(value)} in ${SPEC_FILE_NAME} is not an artifact subdomain`,
    )
  }
  return value
}

export function linkedSpecText(args: { raw: unknown; subdomain: string }): string {
  const subdomain = assertSubdomain(args.subdomain)
  if (!isJsonObject(args.raw)) {
    throw new ArtifactSpecError(`${SPEC_FILE_NAME} must hold a JSON object`)
  }
  const settings = Object.entries(args.raw).filter(([key]) => key !== LINK_FIELD)
  return `${JSON.stringify({ [LINK_FIELD]: subdomain, ...Object.fromEntries(settings) }, null, 2)}\n`
}
