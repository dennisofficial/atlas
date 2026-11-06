import { SessionRoute } from '@/features/sessions/session-route'
import { STATIC_EXPORT_PLACEHOLDER, staticParamsForDesktop } from '@/lib/route-id'

export function generateStaticParams() {
  return staticParamsForDesktop({ sessionId: STATIC_EXPORT_PLACEHOLDER })
}

export default function SessionPage() {
  return <SessionRoute />
}
