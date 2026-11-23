export {
  MAX_CAPTURE_SOURCE_BYTES,
  captureText,
  captureUnavailableFault,
  makeChange,
  type TextCapture,
} from './capture-text'
export { prepareQualityScopes } from './scope-adapter'
export { moduleScopeId, scopeIdOf } from './scope-build'
export { renderScopeDiff } from './scope-diff'
export { EScopeMatchKind, matchScopes, type ScopeMatch } from './scope-matching'
export {
  QUALITY_SOURCE_ADAPTER_VERSION,
  hashScopeText,
  isDeclarationPath,
  parseQualitySource,
  scriptKindForPath,
  type ParsedDeclaration,
  type ParsedDocument,
  type ParsedSource,
} from './typescript-parser'
