import { z } from 'zod'

const HASH = /^[0-9a-f]{16}$/
const ARTIFACT = /^[a-zA-Z0-9][a-zA-Z0-9._-]*\.tar\.gz$/

export const webManifestSchema = z.object({
  schemaVersion: z.literal(1),
  version: z.string().min(1).optional(),
  hash: z.string().regex(HASH),
  artifact: z.string().regex(ARTIFACT),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  size: z.number().int().positive(),
  builtAt: z.iso.datetime(),
  requiresShell: z.number().int().nonnegative(),
})

export type WebManifest = z.infer<typeof webManifestSchema>

export function parseManifest({ input }: { input: unknown }): WebManifest | undefined {
  const parsed = webManifestSchema.safeParse(input)
  return parsed.success ? parsed.data : undefined
}

export enum EPayloadDecision {
  Install = 'install',
  Current = 'current',
  Refuse = 'refuse',
}

export type TPayloadDecision =
  | { decision: EPayloadDecision.Install }
  | { decision: EPayloadDecision.Current }
  | { decision: EPayloadDecision.Refuse; reason: string }

export function decidePayload({
  manifest,
  current,
  contract,
}: {
  manifest: WebManifest
  current: string | undefined
  contract: number
}): TPayloadDecision {
  if (manifest.requiresShell > contract)
    return { decision: EPayloadDecision.Refuse, reason: 'this payload needs a newer Atlas app' }
  if (manifest.hash === current) return { decision: EPayloadDecision.Current }
  return { decision: EPayloadDecision.Install }
}

export function artifactUrl({
  manifest,
  manifestUrl,
}: {
  manifest: WebManifest
  manifestUrl: string
}): string {
  return new URL(manifest.artifact, manifestUrl).toString()
}
