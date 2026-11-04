import { useRef } from 'react'

/**
 * Tap and press-and-hold on one element without fighting page scroll: moving the finger cancels both,
 * so a scroll that starts on a tile never logs anything.
 */
export function useLongPress(onTap: () => void, onLong: () => void, ms = 500) {
  const timer = useRef<number | undefined>(undefined)
  const start = useRef<{ x: number; y: number } | null>(null)
  const fired = useRef(false)

  const clear = () => {
    window.clearTimeout(timer.current)
    timer.current = undefined
  }

  return {
    onPointerDown: (e: React.PointerEvent) => {
      if (e.button !== 0) return
      fired.current = false
      start.current = { x: e.clientX, y: e.clientY }
      clear()
      timer.current = window.setTimeout(() => {
        fired.current = true
        timer.current = undefined
        navigator.vibrate?.(20)
        onLong()
      }, ms)
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (!start.current) return
      if (Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) > 10) {
        clear()
        start.current = null
      }
    },
    onPointerUp: () => {
      const wasPress = start.current && !fired.current
      clear()
      start.current = null
      if (wasPress) onTap()
    },
    onPointerCancel: () => {
      clear()
      start.current = null
    },
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
    // Keyboard users: Enter/Space adds; Backspace/Delete takes one back.
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        onTap()
      } else if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault()
        onLong()
      }
    },
  }
}
