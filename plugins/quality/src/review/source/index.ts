export {
  MAX_CAPTURE_SOURCE_BYTES,
  captureText,
  captureUnavailableFault,
  makeChange,
  type TextCapture,
} from './capture-text'
export {
  MAX_QUALITY_PARSE_CACHE_BYTES,
  MAX_QUALITY_PARSE_CACHE_ENTRIES,
  clearQualityParseCache,
  createQualityParseCache,
  qualityParseCacheStats,
  type QualityParseCache,
  type QualityParseCacheStats,
} from './parse-cache'
export { prepareQualityScopes } from './scope-adapter'
export { moduleScopeId, scopeIdOf } from './scope-build'
export { renderScopeDiff } from './scope-diff'
export { renderUnifiedDiff } from './unified-diff'
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
