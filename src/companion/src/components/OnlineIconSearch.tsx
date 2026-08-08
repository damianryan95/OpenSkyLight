import { useState } from 'react'
import { parentGet, parentMutation } from '../api/client'

type Result = { name: string; label: string }

/** Parent-only online lookup. Selection is imported as a data URI, so displays
 * never depend on Iconify or the Internet after the parent chooses an icon. */
export function OnlineIconSearch({ onPick }: { onPick: (icon: string) => void }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Result[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [color, setColor] = useState('#E45D3F')
  const search = async () => { if (query.trim().length < 2) return; setBusy(true); setError(null); try { setResults((await parentGet<{ icons: Result[] }>(`/api/v1/icons/search?query=${encodeURIComponent(query.trim())}`)).icons) } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not search icons') } finally { setBusy(false) } }
  const pick = async (name: string) => { setBusy(true); setError(null); try { onPick((await parentMutation<{ icon: string }>('/api/v1/icons/import', 'POST', { name, color })).icon); setResults([]) } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not import icon') } finally { setBusy(false) } }
  return <div className="rounded-xl bg-paper-deep/60 p-3"><div className="flex items-center justify-between gap-2"><span className="text-xs font-extrabold text-ink-soft">Imported icon colour</span><span className="flex gap-1.5">{['#E45D3F', '#2379B8', '#218C74', '#8256A5', '#D78924'].map((choice) => <button key={choice} aria-label={`Use icon colour ${choice}`} type="button" onClick={() => setColor(choice)} className={`h-7 w-7 rounded-full border-2 ${color === choice ? 'border-ink ring-2 ring-paper' : 'border-transparent'}`} style={{ backgroundColor: choice }} />)}</span></div><div className="mt-2 flex gap-2"><input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void search() } }} placeholder="Search online, e.g. hair brush" className="min-h-11 min-w-0 flex-1 rounded-lg border border-line bg-paper px-3 font-semibold" /><button type="button" onClick={() => void search()} disabled={busy || query.trim().length < 2} className="min-h-11 rounded-lg bg-card px-3 text-sm font-extrabold disabled:opacity-40">Search</button></div>{error && <p className="mt-2 text-sm font-bold text-red-800">{error}</p>}{results.length > 0 && <div className="mt-3 grid max-h-96 grid-cols-4 gap-2 overflow-y-auto pr-1">{results.map((result) => <button key={result.name} type="button" aria-label={`Use ${result.label}`} onClick={() => void pick(result.name)} disabled={busy} className="flex min-h-16 flex-col items-center justify-center rounded-xl border-2 border-line bg-paper p-1 text-xs font-extrabold disabled:opacity-40"><img src={`https://api.iconify.design/${result.name.replace(':', '/')}.svg?color=${encodeURIComponent(color)}`} alt="" className="h-7 w-7" /><span className="max-w-full truncate">{result.label}</span></button>)}</div>}{results.length === 0 && !busy && <p className="mt-2 text-xs font-semibold text-ink-faint">Searches the full Iconify catalogue. Your selection is saved locally.</p>}</div>
}
