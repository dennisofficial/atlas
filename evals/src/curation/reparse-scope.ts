import { EQualityScopeKind } from '@dltech/atlas-core'

import { parseQualitySource } from '../../../packages/harness/src/quality/source/typescript-parser'
import type { ExportedScope } from './exported-example'

const METHOD_HOST = 'class ReparseHost {\n'

const parseable = ({ kind, text }: { kind: EQualityScopeKind; text: string }): string =>
  kind === EQualityScopeKind.Method ? `${METHOD_HOST}${text}\n}\n` : text

export function reparseScope({ path, scope }: { path: string; scope: ExportedScope }): string | null {
  for (const [side, text] of [['before', scope.before], ['after', scope.after]] as const) {
    if (text === null) continue
    const parsed = parseQualitySource({ path, text: parseable({ kind: scope.kind, text }) })
    if (!parsed.ok) return `${side} text does not parse with the production source parser`
  }
  return null
}
