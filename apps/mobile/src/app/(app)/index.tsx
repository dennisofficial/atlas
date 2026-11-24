import { Redirect } from 'expo-router'

import { SESSIONS_HREF } from '../../navigation/tabs'

export default function AppIndexScreen() {
  return <Redirect href={SESSIONS_HREF} />
}
