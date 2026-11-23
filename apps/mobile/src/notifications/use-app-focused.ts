import { useEffect, useState } from 'react'
import { AppState } from 'react-native'

export const useAppFocused = (): boolean => {
  const [focused, setFocused] = useState(() => AppState.currentState === 'active')
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) =>
      setFocused(state === 'active'),
    )
    return () => subscription.remove()
  }, [])
  return focused
}
