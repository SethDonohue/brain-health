import { useEffect, type ReactNode } from 'react'
import { useUi } from '../store'
import type { Intensity } from '../domain/types'

const cx = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(' ')
export { cx }

export function Sheet({ title, children, onClose }: { title: string; children: ReactNode; onClose?: () => void }) {
  const close = useUi((s) => s.close)
  const done = onClose ?? close
  return (
    <div className="fixed inset-0 z-40 flex flex-col justify-end" role="dialog" aria-modal="true" aria-label={title}>
      <button aria-label="Close" className="absolute inset-0 bg-black/40" onClick={done} />
      <div className="sheet-in relative mx-auto max-h-[calc(100dvh-var(--sat)-24px)] w-full max-w-[480px] overflow-y-auto rounded-t-2xl bg-surface pb-[max(var(--sab),16px)]">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-surface px-4 py-2">
          <h2 className="font-display text-xl font-semibold">{title}</h2>
          <button onClick={done} className="min-h-12 min-w-12 rounded-lg px-3 text-ink-2">
            Close
          </button>
        </div>
        <div className="px-4 pt-4">{children}</div>
      </div>
    </div>
  )
}

export function Button({
  children,
  onClick,
  variant = 'primary',
  className,
  disabled,
  type = 'button',
  ariaLabel,
}: {
  children: ReactNode
  onClick?: () => void
  variant?: 'primary' | 'quiet' | 'outline' | 'danger'
  className?: string
  disabled?: boolean
  type?: 'button' | 'submit'
  ariaLabel?: string
}) {
  return (
    <button
      type={type}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={onClick}
      className={cx(
        'min-h-12 rounded-xl px-4 font-medium transition-colors disabled:opacity-40',
        variant === 'primary' && 'bg-ink text-bg active:opacity-80',
        variant === 'outline' && 'border border-line bg-surface text-ink active:bg-sunk',
        variant === 'quiet' && 'text-ink-2 active:bg-sunk',
        variant === 'danger' && 'text-red active:bg-red-soft',
        className,
      )}
    >
      {children}
    </button>
  )
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  colorFor,
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
  label: string
  colorFor?: (v: T) => string
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex rounded-xl bg-sunk p-1">
      {options.map((o) => {
        const on = o.value === value
        return (
          <button
            key={o.value}
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={cx('min-h-11 flex-1 rounded-lg text-sm font-medium', on ? 'bg-surface shadow-sm' : 'text-ink-2')}
            style={on && colorFor ? { color: colorFor(o.value) } : undefined}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

export const intensityColor = (i: Intensity) =>
  i === 'vigorous' ? 'var(--vigorous)' : i === 'moderate' ? 'var(--moderate)' : 'var(--light)'

export function IntensityPicker({ value, onChange }: { value: Intensity; onChange: (i: Intensity) => void }) {
  return (
    <Segmented
      label="Intensity"
      value={value}
      onChange={onChange}
      colorFor={intensityColor}
      options={[
        { value: 'light', label: 'Light' },
        { value: 'moderate', label: 'Moderate' },
        { value: 'vigorous', label: 'Vigorous' },
      ]}
    />
  )
}

export function Stepper({
  value,
  onChange,
  step,
  min = 0,
  max = 9999,
  label,
  format = (v) => String(v),
}: {
  value: number
  onChange: (v: number) => void
  step: number
  min?: number
  max?: number
  label: string
  format?: (v: number) => string
}) {
  return (
    <div className="flex items-center gap-2" aria-label={label} role="group">
      <button
        aria-label={`Decrease ${label}`}
        className="min-h-12 min-w-12 rounded-xl border border-line text-xl active:bg-sunk"
        onClick={() => onChange(Math.max(min, Math.round((value - step) * 100) / 100))}
      >
        −
      </button>
      <div className="num min-w-24 flex-1 text-center text-2xl font-semibold" aria-live="polite">
        {format(value)}
      </div>
      <button
        aria-label={`Increase ${label}`}
        className="min-h-12 min-w-12 rounded-xl border border-line text-xl active:bg-sunk"
        onClick={() => onChange(Math.min(max, Math.round((value + step) * 100) / 100))}
      >
        +
      </button>
    </div>
  )
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <div className="mb-5">
      <div className="mb-2 text-sm font-medium text-ink-2">{label}</div>
      {children}
      {hint && <div className="mt-1 text-sm text-ink-3">{hint}</div>}
    </div>
  )
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex min-h-12 w-full items-center justify-between gap-4 text-left"
    >
      <span>{label}</span>
      <span className={cx('relative h-7 w-12 shrink-0 rounded-full transition-colors', checked ? 'bg-moderate' : 'bg-line')}>
        <span
          className={cx('absolute top-1 h-5 w-5 rounded-full bg-white transition-transform', checked ? 'translate-x-6' : 'translate-x-1')}
        />
      </span>
    </button>
  )
}

export function ToastHost() {
  const toast = useUi((s) => s.toast)
  const clear = useUi((s) => s.clearToast)
  // With a sheet open, the bottom holds the sheet's own buttons, so toasts move to the top.
  const sheetOpen = useUi((s) => s.sheets.length > 0)
  useEffect(() => {
    if (!toast) return
    const id = setTimeout(clear, 6000)
    return () => clearTimeout(id)
  }, [toast, clear])
  if (!toast) return null
  return (
    <div
      className={cx(
        'pointer-events-none fixed inset-x-0 z-50 flex justify-center px-3',
        sheetOpen ? 'top-[calc(var(--sat)+8px)]' : 'bottom-[calc(var(--footer-h)+8px)]',
      )}
    >
      <div
        key={toast.id}
        role="status"
        className="toast-in pointer-events-auto flex w-full max-w-[456px] items-center gap-1 rounded-xl bg-ink py-1 pl-4 pr-1 text-bg"
      >
        <span className="flex-1 py-2 text-sm">{toast.message}</span>
        {toast.secondary && (
          <button
            className="min-h-11 rounded-lg px-3 text-sm font-semibold"
            onClick={() => {
              toast.secondary!.run()
              clear()
            }}
          >
            {toast.secondary.label}
          </button>
        )}
        {toast.action && (
          <button
            className="min-h-11 rounded-lg px-3 text-sm font-semibold"
            onClick={() => {
              toast.action!.run()
              clear()
            }}
          >
            {toast.action.label}
          </button>
        )}
      </div>
    </div>
  )
}
