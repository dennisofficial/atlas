const MAX_MESSAGE_CHARS = 500
const SECRET_SHAPES = new RegExp(
  [
    String.raw`\b(?:sk|pk|rk|key)-[A-Za-z0-9_-]{6,}`,
    String.raw`Bearer\s+[A-Za-z0-9._~+/=-]+`,
    'AIza[0-9A-Za-z_-]{20,}',
    String.raw`eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+`,
  ].join('|'),
  'gi',
)
const SECRET_QUERY_PARAM = /\b(api_key|apikey|key|token|access_token)=[^&\s]+/gi

export const safeFailureMessage = (message: string): string =>
  message
    .replace(SECRET_QUERY_PARAM, '$1=[redacted]')
    .replace(SECRET_SHAPES, '[redacted]')
    .slice(0, MAX_MESSAGE_CHARS)
