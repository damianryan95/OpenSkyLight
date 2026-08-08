import { useEffect, type ReactNode } from 'react'
import { XIcon } from './icons'
import { useOsk } from './Osk'

export function BigButton({
  children,
  onClick,
  variant = 'primary',
  disabled,
  className = ''
}: {
  children: ReactNode
  onClick?: () => void
  variant?: 'primary' | 'ghost' | 'danger'
  disabled?: boolean
  className?: string
}) {
  const styles = {
    primary: 'bg-ember text-white shadow-card hover:bg-ember-deep',
    ghost: 'bg-paper-deep text-ink hover:bg-line',
    danger: 'bg-transparent text-ember-deep border-2 border-ember-soft hover:bg-ember-soft'
  }[variant]
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`pressable min-h-14 rounded-2xl px-6 text-lg font-bold disabled:opacity-40 ${styles} ${className}`}
    >
      {children}
    </button>
  )
}

export function IconButton({
  children,
  onClick,
  label,
  className = ''
}: {
  children: ReactNode
  onClick?: () => void
  label: string
  className?: string
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={`pressable flex h-13 w-13 items-center justify-center rounded-full text-ink-soft hover:bg-paper-deep ${className}`}
    >
      {children}
    </button>
  )
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange
}: {
  options: { value: T; label: string }[]
  value: T
  onChange: (value: T) => void
}) {
  return (
    <div className="flex rounded-2xl bg-paper-deep p-1">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={`pressable min-h-12 rounded-xl px-2 text-base font-bold transition-colors min-[1500px]:px-3 ${
            value === opt.value ? 'bg-card text-ink shadow-card' : 'text-ink-soft'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`pressable relative h-9 w-16 rounded-full transition-colors ${checked ? 'bg-ember' : 'bg-line'}`}
    >
      <span
        className={`absolute top-1 h-7 w-7 rounded-full bg-card shadow-card transition-all ${checked ? 'left-8' : 'left-1'}`}
      />
    </button>
  )
}

export function Sheet({
  open,
  onClose,
  children,
  title,
  wide
}: {
  open: boolean
  onClose: () => void
  children: ReactNode
  title?: string
  wide?: boolean
}) {
  // when the on-screen keyboard is up, pad the sheet so bottom controls stay reachable
  const oskOpen = useOsk((s) => s.target !== null)
  // the keyboard must never outlive the sheet that hosts its input
  useEffect(() => {
    if (!open) useOsk.getState().close()
    return () => useOsk.getState().close()
  }, [open])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-40">
      <div className="animate-fade-in absolute inset-0 bg-ink/35 backdrop-blur-[3px]" onClick={onClose} />
      <div
        className={`animate-sheet-up absolute inset-x-0 bottom-0 mx-auto max-h-[94vh] w-full ${
          wide ? 'max-w-5xl' : 'max-w-2xl'
        } overflow-y-auto rounded-t-3xl bg-card p-6 shadow-float ${oskOpen ? 'pb-80' : ''}`}
      >
        {title && (
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-display text-3xl font-semibold">{title}</h2>
            <IconButton label="Close" onClick={onClose}>
              <XIcon size={26} />
            </IconButton>
          </div>
        )}
        {children}
      </div>
    </div>
  )
}

export function Dialog({
  open,
  onClose,
  children,
  title
}: {
  open: boolean
  onClose: () => void
  children: ReactNode
  title?: string
}) {
  // shift above the on-screen keyboard while an input inside is focused
  const oskOpen = useOsk((s) => s.target !== null)
  // the keyboard must never outlive the dialog that hosts its input
  useEffect(() => {
    if (!open) useOsk.getState().close()
    return () => useOsk.getState().close()
  }, [open])
  if (!open) return null
  return (
    <div className={`fixed inset-0 z-50 flex justify-center p-6 ${oskOpen ? 'items-start pt-4' : 'items-center'}`}>
      <div className="animate-fade-in absolute inset-0 bg-ink/35 backdrop-blur-[3px]" onClick={onClose} />
      <div
        className={`animate-pop relative w-full max-w-md overflow-y-auto rounded-3xl bg-card p-6 shadow-float ${
          oskOpen ? 'max-h-[52vh]' : 'max-h-[90vh]'
        }`}
      >
        {title && <h3 className="font-display mb-4 text-2xl font-semibold">{title}</h3>}
        {children}
      </div>
    </div>
  )
}

export function FieldLabel({ children }: { children: ReactNode }) {
  return (
    <div className="mb-1.5 text-sm font-extrabold tracking-wide text-ink-faint uppercase">{children}</div>
  )
}
