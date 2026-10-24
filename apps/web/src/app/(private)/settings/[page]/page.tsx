import { notFound } from 'next/navigation'

import { parseSettingsPage } from '@/features/settings/settings-nav'
import { SettingsRoute } from '@/features/settings/settings-route'

export default async function SettingsPage({ params }: { params: Promise<{ page: string }> }) {
  const { page } = await params
  const parsed = parseSettingsPage(page)
  if (parsed === null) notFound()
  return <SettingsRoute page={parsed} />
}
