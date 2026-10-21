import { MEMORY_STALE_REVISION_CODE } from '@dltech/atlas-wire/web'

import { CloudApiError } from '@/lib/cloud-api'

const HTTP_CONFLICT = 409
const CHANGED_ELSEWHERE = 'This changed elsewhere. Reload the page and try again.'
const FALLBACK = 'Could not save the change'

export function errorMessageOf(error: unknown): string {
  if (error instanceof CloudApiError) {
    if (error.code === MEMORY_STALE_REVISION_CODE || error.status === HTTP_CONFLICT) {
      return CHANGED_ELSEWHERE
    }
    return error.message
  }
  return error instanceof Error && error.message.length > 0 ? error.message : FALLBACK
}
