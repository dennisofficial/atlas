import { redirect } from 'next/navigation'

import { readServerSession } from '@/lib/server-session'

export default async function RootPage() {
  const signedIn = await readServerSession()
  redirect(signedIn ? '/threads' : '/sign-in')
}
