import { createToolPictureLoader } from '@dltech/atlas-client/session'

import { api, cloudCall } from '@/lib/api-client'

export const toolPictures = createToolPictureLoader({
  fetch: async ({ sessionId, threadId, seq, part }) =>
    cloudCall(api.media.toolPicture.query({ sessionId, threadId, seq, part })),
})
