import { serviceWorkerSource } from '@/lib/service-worker-source'

export const dynamic = 'force-static'

export function GET() {
  return new Response(serviceWorkerSource, {
    status: 200,
    headers: {
      'content-type': 'application/javascript; charset=utf-8',
      'service-worker-allowed': '/',
      'cache-control': 'no-store',
    },
  })
}
