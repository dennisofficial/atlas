import { GroupOverviewPage } from '@/features/groups/overview-page'

export default async function Page({ params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params
  return <GroupOverviewPage groupId={groupId} />
}
