import { InviteFlow } from '@/features/auth/invite-flow'

export default async function InvitePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <InviteFlow invitationId={id} />
}
