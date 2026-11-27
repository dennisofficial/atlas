import { useEffect, useState } from 'react'
import { AccessibilityInfo } from 'react-native'

export const useReduceMotion = (): boolean => {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    let live = true
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (live) setReduced(enabled)
    })
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced)
    return () => {
      live = false
      subscription.remove()
    }
  }, [])
  return reduced
}
