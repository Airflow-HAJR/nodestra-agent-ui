import { useEffect, useRef, useState } from 'react'

// Reveals `target` one character at a time. Handles text that arrives in
// growing chunks (e.g. live interim transcripts) by continuing from the
// already-revealed prefix instead of restarting, and only resets to empty
// when the new target isn't an extension of what's currently shown.
export function useTypewriter(target: string, msPerChar = 22): string {
  const [displayed, setDisplayed] = useState('')
  const displayedRef = useRef('')
  const targetRef = useRef(target)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => { targetRef.current = target }, [target])

  useEffect(() => {
    if (!target) {
      if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null }
      displayedRef.current = ''
      setDisplayed('')
      return
    }

    if (!target.startsWith(displayedRef.current)) {
      displayedRef.current = ''
      setDisplayed('')
    }

    if (intervalRef.current) return

    intervalRef.current = setInterval(() => {
      const full = targetRef.current
      const cur = displayedRef.current
      if (cur.length >= full.length) {
        clearInterval(intervalRef.current!)
        intervalRef.current = null
        return
      }
      const next = full.slice(0, cur.length + 1)
      displayedRef.current = next
      setDisplayed(next)
    }, msPerChar)
  }, [target, msPerChar])

  useEffect(() => () => { if (intervalRef.current) clearInterval(intervalRef.current) }, [])

  return displayed
}
