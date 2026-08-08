import type { ReactNode } from 'react'

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-card bg-card p-4 shadow-card ${className}`}>{children}</div>
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return <div className="mb-2 text-xs font-extrabold tracking-wider text-ink-faint uppercase">{children}</div>
}

/** Big round tap target for checking things off. */
export function CheckCircle({
  checked,
  color,
  onTap,
  label
}: {
  checked: boolean
  color?: string
  onTap: () => void
  label: string
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onTap}
      className="pressable flex h-11 w-11 shrink-0 items-center justify-center"
    >
      <span
        className={`flex h-7 w-7 items-center justify-center rounded-full border-2 transition-colors ${
          checked ? 'border-transparent text-white' : 'border-line bg-transparent'
        }`}
        style={checked ? { backgroundColor: color ?? 'var(--color-ember)' } : undefined}
      >
        {checked && (
          <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M3 8.5 6.5 12 13 4.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </span>
    </button>
  )
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('')
}

export function textOn(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return 0.299 * r + 0.587 * g + 0.114 * b > 160 ? '#34302a' : '#ffffff'
}

export function PersonAvatar({ name, color, avatarUrl, size = 'md' }: { name: string; color: string; avatarUrl?: string | null; size?: 'sm' | 'md' }) {
  const cls = size === 'sm' ? 'h-6 w-6 text-[10px]' : 'h-9 w-9 text-sm'
  return (
    <span
      className={`flex ${cls} shrink-0 items-center justify-center rounded-full font-extrabold`}
      style={{ backgroundColor: color, color: textOn(color) }}
    >
      {avatarUrl ? <img src={avatarUrl} alt="" className="h-full w-full rounded-full object-cover" /> : initials(name)}
    </span>
  )
}

export function PrimaryButton({
  children,
  onClick,
  disabled,
  type = 'button'
}: {
  children: ReactNode
  onClick?: () => void
  disabled?: boolean
  type?: 'button' | 'submit'
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className="pressable min-h-11 rounded-xl bg-ember px-4 text-base font-extrabold text-white disabled:opacity-40"
    >
      {children}
    </button>
  )
}

export function GhostButton({
  children,
  onClick,
  type = 'button'
}: {
  children: ReactNode
  onClick?: () => void
  type?: 'button' | 'submit'
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      className="pressable min-h-11 rounded-xl bg-paper-deep px-4 text-base font-extrabold text-ink-soft"
    >
      {children}
    </button>
  )
}

export function TextInput({
  value,
  onChange,
  placeholder,
  autoFocus,
  inputMode,
  type = 'text'
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  autoFocus?: boolean
  inputMode?: 'text' | 'numeric'
  type?: 'text' | 'password'
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      autoFocus={autoFocus}
      inputMode={inputMode}
      enterKeyHint="done"
      className="min-h-11 w-full min-w-0 rounded-xl border border-line bg-paper px-3 text-base font-semibold outline-none placeholder:text-ink-faint focus:border-ember"
    />
  )
}

export function EmptyNote({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-base font-semibold text-ink-faint">{children}</p>
}
