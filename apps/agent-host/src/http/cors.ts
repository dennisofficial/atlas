import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface'

export const JSON_BODY_LIMIT = '128kb'

export const corsOptionsOf = (trustedOrigins: readonly string[]): CorsOptions => ({
  origin: trustedOrigins.length === 0 ? true : [...trustedOrigins],
  methods: 'POST, OPTIONS',
  allowedHeaders: 'authorization, content-type',
  maxAge: 600,
})
