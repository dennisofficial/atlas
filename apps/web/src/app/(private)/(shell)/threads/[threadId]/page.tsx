import { ThreadView } from '@/features/threads/thread-view'

export default async function ThreadPage({ params }: { params: Promise<{ threadId: string }> }) {
  const { threadId } = await params
  return <ThreadView threadId={threadId} />
}
