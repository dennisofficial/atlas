import { ThreadRoute } from '@/features/threads/thread-route'
import { STATIC_EXPORT_PLACEHOLDER, staticParamsForDesktop } from '@/lib/route-id'

export function generateStaticParams() {
  return staticParamsForDesktop({ threadId: STATIC_EXPORT_PLACEHOLDER })
}

export default function ThreadPage() {
  return <ThreadRoute />
}
