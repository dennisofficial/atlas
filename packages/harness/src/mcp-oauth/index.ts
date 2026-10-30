export {
  discoverAuthorizationServerMetadata,
  discoverProtectedResourceMetadata,
  parseWwwAuthenticate,
  selectScope,
} from '../mcp/oauth/discovery'
export type {
  AuthorizationServerMetadata,
  OAuthFetch,
  ProtectedResourceMetadata,
  WwwAuthenticateChallenge,
} from '../mcp/oauth/discovery'
export { EOAuthFailure, OAuthError, parseOAuthErrorBody } from '../mcp/oauth/oauth-error'
export type { OAuthErrorBody } from '../mcp/oauth/oauth-error'
export { generatePkce } from '../mcp/oauth/pkce'
export type { Pkce } from '../mcp/oauth/pkce'
export { registerClient } from '../mcp/oauth/registration'
export type { ClientInformation } from '../mcp/oauth/registration'
export {
  buildAuthorizationUrl,
  exchangeAuthorizationCode,
  refreshAuthorization,
} from '../mcp/oauth/token'
export type { OAuthTokens } from '../mcp/oauth/token'
