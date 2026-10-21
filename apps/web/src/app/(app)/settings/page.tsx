import { redirect } from 'next/navigation'

import { ESettingsPage, hrefOfPage } from '@/features/settings/settings-nav'

export default function SettingsIndexPage() {
  redirect(hrefOfPage(ESettingsPage.Account))
}
