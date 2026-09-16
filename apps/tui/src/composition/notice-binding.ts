import { NoticePort } from '@dltech/atlas-core'

import { notify } from '../ui/notice-store'

export function noticePortBinding(): NoticePort {
  return {
    notify: (post) =>
      notify({
        text: post.text,
        tone: post.tone,
        ...(post.key === undefined ? {} : { key: post.key }),
        ...(post.ttlMs === null
          ? { sticky: true }
          : post.ttlMs === undefined
            ? {}
            : { ttlMs: post.ttlMs }),
      }),
  }
}
