import type { QualityCoverageDiagnostic } from './policy'

export enum EQualityLanguage {
  TypeScript = 'typescript',
  JavaScript = 'javascript',
}

export enum EQualityScopeKind {
  Module = 'module',
  Class = 'class',
  Method = 'method',
  Function = 'function',
}

export type CapturedFileChange = {
  path: string
  before: string | null
  after: string
}

export type QualityEvidence = {
  id: string
  label: string
  changed: boolean
}

export type QualityLineRange = { start: number; end: number }

export type QualityScopeIdentity = {
  id: string
  workspaceNamespace: string
  path: string
  language: EQualityLanguage
  kind: EQualityScopeKind
  name: string
  adapterVersion: string
  structuralHash: string
  parentScopeId: string | null
  lineRange: QualityLineRange | null
}

export type QualityScope = QualityScopeIdentity & {
  before: string | null
  after: string | null
  diff: string
  beforeHash: string | null
  afterHash: string | null
  evidence: readonly QualityEvidence[]
  dependencyContext: readonly string[]
  beforeLineRange: QualityLineRange | null
  afterLineRange: QualityLineRange | null
}

export type QualityScopePreparation = {
  scopes: readonly QualityScope[]
  skipped: readonly QualityCoverageDiagnostic[]
}
