import { api, cloudCall } from '@/lib/api-client'

import { createMediaUrlCache } from './media-url-cache'

export const mediaUrls = createMediaUrlCache({
  fetch: async (key) => (await cloudCall(api.media.url.query(key))).url,
})
