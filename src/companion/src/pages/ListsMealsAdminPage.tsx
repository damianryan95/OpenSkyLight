import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { DateTime } from 'luxon'
import { useState, type FormEvent } from 'react'
import type { ListKind, MealSlotKind } from '@shared/types'
import { parentGet, parentMutation, parentUpload } from '../api/client'
import { Card, CheckCircle, EmptyNote, GhostButton, PrimaryButton, TextInput } from '../components/ui'

type ListItem = { id: string; text: string; checked: boolean; sortOrder: number }
type List = { id: string; name: string; color: string; kind: ListKind; items: ListItem[] }
type Meal = { date: string; slot: MealSlotKind; text: string }
type MealTemplate = { dayOfWeek: number; slot: MealSlotKind; text: string }

const COLORS = ['#46A758', '#0091FF', '#FFB224', '#6E56CF', '#E5484D', '#D95B3A']
const SLOTS: MealSlotKind[] = ['breakfast', 'lunch', 'dinner']

/** Phone-sized parent commands. Kiosk list/meal reads remain separate RPC calls. */
export function ListsMealsAdminPage() {
  const client = useQueryClient()
  const [weekStart, setWeekStart] = useState(() => DateTime.now().startOf('week'))
  const start = weekStart.toISODate()!; const end = weekStart.plus({ days: 6 }).toISODate()!
  const lists = useQuery({ queryKey: ['planning', 'lists'], queryFn: () => parentGet<{ lists: List[] }>('/api/v1/lists') })
  const meals = useQuery({ queryKey: ['planning', 'meals', start, end], queryFn: () => parentGet<{ meals: Meal[] }>(`/api/v1/meals?start=${start}&end=${end}`) })
  const templates = useQuery({ queryKey: ['planning', 'meal-templates'], queryFn: () => parentGet<{ templates: MealTemplate[] }>('/api/v1/meal-templates') })
  const invalidateLists = () => void client.invalidateQueries({ queryKey: ['planning', 'lists'] })
  const invalidateMeals = () => void client.invalidateQueries({ queryKey: ['planning', 'meals'] })
  const listCommand = useMutation({ mutationFn: ({ path, method, body }: { path: string; method: 'POST' | 'PATCH' | 'DELETE'; body?: unknown }) => parentMutation(path, method, body), onSuccess: invalidateLists })
  const mealCommand = useMutation({ mutationFn: ({ date, slot, text }: { date: string; slot: MealSlotKind; text: string | null }) => parentMutation(`/api/v1/meals/${date}/${slot}`, 'PUT', { text }), onSuccess: invalidateMeals })
  const templateCommand = useMutation({ mutationFn: ({ dayOfWeek, slot, text }: { dayOfWeek: number; slot: MealSlotKind; text: string | null }) => parentMutation(`/api/v1/meal-templates/${dayOfWeek}/${slot}`, 'PUT', { text }), onSuccess: () => { void client.invalidateQueries({ queryKey: ['planning', 'meal-templates'] }); invalidateMeals() } })
  const error = (listCommand.error ?? mealCommand.error) instanceof Error ? (listCommand.error ?? mealCommand.error)!.message : null

  return <div className="mt-4 space-y-5">
    {error && <p role="alert" className="rounded-xl bg-red-100 p-3 text-sm font-bold text-red-800">{error}</p>}
    <section aria-labelledby="lists-heading"><div className="mb-2 flex items-center justify-between"><h3 id="lists-heading" className="font-display text-xl font-semibold">Lists</h3><NewListButton count={lists.data?.lists.length ?? 0} onCreate={(body) => listCommand.mutate({ path: '/api/v1/lists', method: 'POST', body })} /></div>
      {lists.isPending ? <EmptyNote>Loading lists…</EmptyNote> : (lists.data?.lists ?? []).length === 0 ? <EmptyNote>Create a grocery, to-do, or custom list.</EmptyNote> : lists.data!.lists.map((list) => <ListCard key={list.id} list={list} busy={listCommand.isPending} command={(path, method, body) => listCommand.mutate({ path, method, body })} />)}
    </section>
    <section aria-labelledby="meal-templates-heading"><h3 id="meal-templates-heading" className="mb-1 font-display text-xl font-semibold">Weekly meal defaults</h3><p className="mb-3 text-sm font-semibold text-ink-faint">Pre-fill recurring meals such as Friday dinner. A dated meal overrides its weekly default.</p><MealTemplates templates={templates.data?.templates ?? []} busy={templateCommand.isPending} onSave={(dayOfWeek, slot, text) => templateCommand.mutate({ dayOfWeek, slot, text })} /></section>
    <PhotosSection />
    <section aria-labelledby="meals-heading"><div className="mb-2 flex items-center justify-between gap-2"><h3 id="meals-heading" className="font-display text-xl font-semibold">Meal plan</h3><div className="flex gap-1"><GhostButton onClick={() => setWeekStart((day) => day.minus({ weeks: 1 }))}>←</GhostButton><GhostButton onClick={() => setWeekStart((day) => day.plus({ weeks: 1 }))}>→</GhostButton></div></div>
      <p className="mb-3 px-1 text-sm font-bold text-ink-faint">Week of {weekStart.toFormat('d LLL')}</p>
      <MealWeek start={weekStart} meals={meals.data?.meals ?? []} busy={mealCommand.isPending} onSave={(date, slot, text) => mealCommand.mutate({ date, slot, text })} />
    </section>
  </div>
}

function MealTemplates({ templates, busy, onSave }: { templates: MealTemplate[]; busy: boolean; onSave: (dayOfWeek: number, slot: MealSlotKind, text: string | null) => void }) {
  const [editing, setEditing] = useState<{ dayOfWeek: number; slot: MealSlotKind; text: string } | null>(null)
  const dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
  return <div className="space-y-2">{dayNames.map((name, index) => { const dayOfWeek = index + 1; const values = templates.filter((template) => template.dayOfWeek === dayOfWeek); return <Card key={name}><h4 className="font-bold">{name}</h4>{SLOTS.map((slot) => { const current = values.find((template) => template.slot === slot)?.text ?? ''; const active = editing?.dayOfWeek === dayOfWeek && editing.slot === slot; return <div key={slot} className="flex min-h-11 items-center gap-2 border-t border-line/60"><span className="w-20 text-xs font-extrabold uppercase text-ember">{slot}</span>{active ? <form className="flex min-w-0 flex-1 gap-2 py-1" onSubmit={(event) => { event.preventDefault(); onSave(dayOfWeek, slot, editing.text.trim() || null); setEditing(null) }}><TextInput value={editing.text} onChange={(text) => setEditing({ ...editing, text })} autoFocus /><PrimaryButton type="submit" disabled={busy}>Save</PrimaryButton></form> : <button type="button" className="min-w-0 flex-1 py-2 text-left font-semibold" onClick={() => setEditing({ dayOfWeek, slot, text: current })}>{current || <span className="text-ink-faint">No default</span>}</button>}</div>})}</Card> })}</div>
}

function NewListButton({ count, onCreate }: { count: number; onCreate: (input: { name: string; color: string; kind: ListKind }) => void }) {
  const [open, setOpen] = useState(false); const [name, setName] = useState(''); const [kind, setKind] = useState<ListKind>('grocery')
  if (!open) return <GhostButton onClick={() => setOpen(true)}>Add list</GhostButton>
  return <Card className="mb-3"><form className="space-y-3" onSubmit={(event) => { event.preventDefault(); if (!name.trim()) return; onCreate({ name: name.trim(), kind, color: COLORS[count % COLORS.length]! }); setName(''); setOpen(false) }}><TextInput value={name} onChange={setName} placeholder="List name" autoFocus /><select aria-label="List type" className="min-h-11 w-full rounded-xl border border-line bg-paper px-3 font-semibold" value={kind} onChange={(event) => setKind(event.target.value as ListKind)}><option value="grocery">Grocery</option><option value="todo">To-do</option><option value="custom">Custom</option></select><div className="flex gap-2"><PrimaryButton type="submit" disabled={!name.trim()}>Create list</PrimaryButton><GhostButton onClick={() => setOpen(false)}>Cancel</GhostButton></div></form></Card>
}

function ListCard({ list, command, busy }: { list: List; busy: boolean; command: (path: string, method: 'POST' | 'PATCH' | 'DELETE', body?: unknown) => void }) {
  const [item, setItem] = useState(''); const [editing, setEditing] = useState(false); const [name, setName] = useState(list.name)
  const unchecked = list.items.filter((value) => !value.checked); const checked = list.items.filter((value) => value.checked)
  const add = (event: FormEvent) => { event.preventDefault(); if (!item.trim()) return; command(`/api/v1/lists/${encodeURIComponent(list.id)}/items`, 'POST', { text: item.trim() }); setItem('') }
  return <Card className="mb-3"><div className="flex items-center gap-2"><span className="h-3.5 w-3.5 rounded-full" style={{ backgroundColor: list.color }} />{editing ? <form className="flex min-w-0 flex-1 gap-2" onSubmit={(event) => { event.preventDefault(); if (!name.trim()) return; command(`/api/v1/lists/${encodeURIComponent(list.id)}`, 'PATCH', { name: name.trim() }); setEditing(false) }}><TextInput value={name} onChange={setName} autoFocus /><PrimaryButton type="submit">Save</PrimaryButton></form> : <><div className="min-w-0 flex-1"><p className="truncate font-display text-xl font-semibold">{list.name}</p><p className="text-xs font-bold text-ink-faint capitalize">{list.kind}</p></div><button type="button" className="pressable min-h-11 px-2 font-extrabold text-ember" onClick={() => setEditing(true)}>Edit</button></>}</div>
    <div className="mt-2">{unchecked.map((value) => <ItemRow key={value.id} item={value} color={list.color} onToggle={() => command(`/api/v1/list-items/${encodeURIComponent(value.id)}/toggle`, 'POST')} onDelete={() => command(`/api/v1/list-items/${encodeURIComponent(value.id)}`, 'DELETE')} />)}{unchecked.length === 0 && <p className="py-2 text-sm font-bold text-ink-faint">{checked.length ? 'All done!' : 'No items yet.'}</p>}{checked.map((value) => <ItemRow key={value.id} item={value} color={list.color} onToggle={() => command(`/api/v1/list-items/${encodeURIComponent(value.id)}/toggle`, 'POST')} onDelete={() => command(`/api/v1/list-items/${encodeURIComponent(value.id)}`, 'DELETE')} />)}</div>
    <form className="mt-2 flex gap-2" onSubmit={add}><TextInput value={item} onChange={setItem} placeholder="Add an item" /><PrimaryButton type="submit" disabled={busy || !item.trim()}>Add</PrimaryButton></form><div className="mt-2 flex gap-2">{checked.length > 0 && <GhostButton onClick={() => command(`/api/v1/lists/${encodeURIComponent(list.id)}/items/checked`, 'DELETE')}>Clear done</GhostButton>}<button type="button" className="pressable min-h-11 px-2 text-sm font-extrabold text-red-700" onClick={() => command(`/api/v1/lists/${encodeURIComponent(list.id)}`, 'DELETE')}>Delete list</button></div>
  </Card>
}

function ItemRow({ item, color, onToggle, onDelete }: { item: ListItem; color: string; onToggle: () => void; onDelete: () => void }) {
  return <div className="flex items-center border-b border-line/60 last:border-0"><CheckCircle checked={item.checked} color={color} onTap={onToggle} label={`${item.checked ? 'Uncheck' : 'Check off'} ${item.text}`} /><span className={`min-w-0 flex-1 truncate py-2 font-semibold ${item.checked ? 'text-ink-faint line-through' : ''}`}>{item.text}</span><button type="button" aria-label={`Delete ${item.text}`} className="pressable min-h-11 px-2 font-bold text-ink-faint" onClick={onDelete}>×</button></div>
}

function MealWeek({ start, meals, busy, onSave }: { start: DateTime; meals: Meal[]; busy: boolean; onSave: (date: string, slot: MealSlotKind, text: string | null) => void }) {
  const [editing, setEditing] = useState<{ date: string; slot: MealSlotKind; text: string } | null>(null)
  const textFor = (date: string, slot: MealSlotKind) => meals.find((meal) => meal.date === date && meal.slot === slot)?.text ?? ''
  return <div className="space-y-3">{Array.from({ length: 7 }, (_, index) => { const day = start.plus({ days: index }); const date = day.toISODate()!; return <Card key={date}><h4 className="font-display text-lg font-semibold">{index === 0 ? 'Monday' : day.toFormat('cccc')} <span className="font-sans text-sm text-ink-faint">{day.toFormat('d LLL')}</span></h4>{SLOTS.map((slot) => { const current = textFor(date, slot); const active = editing?.date === date && editing.slot === slot; return <div key={slot} className="flex min-h-11 items-center gap-2 border-b border-line/60 last:border-0"><span className="w-20 shrink-0 text-xs font-extrabold uppercase text-ember">{slot}</span>{active ? <form className="flex flex-1 gap-2 py-1" onSubmit={(event) => { event.preventDefault(); onSave(date, slot, editing.text.trim() || null); setEditing(null) }}><TextInput value={editing.text} onChange={(text) => setEditing({ ...editing, text })} autoFocus placeholder="What's cooking?" /><PrimaryButton type="submit" disabled={busy}>Save</PrimaryButton></form> : <button type="button" className="pressable min-w-0 flex-1 py-2 text-left font-semibold" onClick={() => setEditing({ date, slot, text: current })}>{current || <span className="text-ink-faint">Add…</span>}</button>}</div> })}</Card> })}</div>
}

interface PhotoAsset { id: string; originalName: string; mediaType: string; byteSize: number; width: number; height: number }

/**
 * Family photos for the kiosk photo tile. Upstream pointed at a folder on the
 * display; with browser kiosks there is no such folder, so photos live on the
 * server and are uploaded from the phone like celebration media.
 */
function PhotosSection() {
  const client = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const photos = useQuery({ queryKey: ['planning', 'photos'], queryFn: () => parentGet<{ assets: PhotoAsset[] }>('/api/v1/media/photos') })
  const refresh = () => void client.invalidateQueries({ queryKey: ['planning', 'photos'] })

  const add = async (files: FileList | null) => {
    if (files === null || files.length === 0) return
    setBusy(true); setError(null)
    const results = await Promise.allSettled([...files].map((file) => parentUpload<PhotoAsset>('/api/v1/media/photos', file)))
    const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
    if (failure !== undefined) setError(failure.reason instanceof Error ? failure.reason.message : 'That photo could not be added.')
    refresh(); setBusy(false)
  }

  const remove = async (id: string) => {
    setBusy(true); setError(null)
    try { await parentMutation(`/api/v1/media/photos/${encodeURIComponent(id)}`, 'DELETE'); refresh() }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'That photo could not be removed.') }
    finally { setBusy(false) }
  }

  const assets = photos.data?.assets ?? []
  return <section aria-labelledby="photos-heading">
    <h3 id="photos-heading" className="mb-1 font-display text-xl font-semibold">Family photos</h3>
    <p className="mb-3 text-sm font-semibold text-ink-faint">Photos shown by the Photos tile on your displays. JPEG, PNG, and WebP up to 25 MB each.</p>
    {error && <p role="alert" className="mb-2 rounded-xl bg-red-100 p-3 text-sm font-bold text-red-800">{error}</p>}
    <Card>
      <label className="block"><span className="mb-1 block text-sm font-extrabold">Add photos</span>
        <input type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={busy}
          onChange={(event) => { void add(event.target.files); event.target.value = '' }}
          className="block w-full text-sm font-semibold" />
      </label>
      {photos.isPending && <p className="mt-3 text-sm font-bold text-ink-faint">Loading photos…</p>}
      {!photos.isPending && assets.length === 0 && <p className="mt-3 text-sm font-bold text-ink-faint">No photos yet. Add a few and they will appear on any display with a Photos tile.</p>}
      {assets.length > 0 && <div className="mt-3 grid grid-cols-3 gap-2">
        {assets.map((asset) => <div key={asset.id} className="relative">
          <img src={`/api/v1/media/photos/${encodeURIComponent(asset.id)}/content`} alt={asset.originalName}
            className="aspect-square w-full rounded-xl object-cover" />
          <button type="button" aria-label={`Remove ${asset.originalName}`} disabled={busy}
            onClick={() => void remove(asset.id)}
            className="pressable absolute top-1 right-1 h-8 w-8 rounded-full bg-ink/70 font-extrabold text-paper">×</button>
        </div>)}
      </div>}
    </Card>
  </section>
}
