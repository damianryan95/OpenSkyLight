import { useState } from 'react'
import type { ListDto, ListKind } from '@shared/types'
import { PERSON_COLORS } from '@shared/types'
import { useListMutations, useLists } from '../../api/hooks'
import { BigButton, Dialog, FieldLabel, SegmentedControl } from '../../components/ui'
import { OskInput } from '../../components/Osk'
import { CheckIcon, PlusIcon, XIcon } from '../../components/icons'
import { textOn } from '../../lib/format'
import { isDisplayClient } from '../../lib/clientMode'

function AddItemRow({ listId }: { listId: string }) {
  const [text, setText] = useState('')
  const mutations = useListMutations()
  const add = (): void => {
    if (!text.trim()) return
    mutations.addItem.mutate({ listId, text: text.trim() }, { onSuccess: () => setText('') })
  }
  return (
    <div className="mt-2 flex items-center gap-2">
      <OskInput value={text} onChange={setText} placeholder="Add item…" className="min-h-12 text-base" />
      <button
        type="button"
        onClick={add}
        disabled={!text.trim()}
        className="pressable flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-ember text-white disabled:opacity-30"
        aria-label="Add item"
      >
        <PlusIcon size={22} />
      </button>
    </div>
  )
}

function ListCard({ list, readOnly }: { list: ListDto; readOnly: boolean }) {
  const mutations = useListMutations()
  const checkedCount = list.items.filter((i) => i.checked).length
  return (
    <div className="flex max-h-full w-80 shrink-0 flex-col rounded-card bg-card p-4 shadow-card">
      <div className="mb-2 flex items-center gap-2.5 text-left">
        <span className="h-5 w-5 rounded-full" style={{ backgroundColor: list.color }} />
        <span className="min-w-0 flex-1 truncate font-display text-2xl font-semibold">{list.name}</span>
        <span className="text-sm font-extrabold text-ink-faint">
          {list.items.length - checkedCount}
        </span>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
        {list.items.map((item) => (
          <div key={item.id} className="group flex items-center gap-2.5 rounded-xl px-1 py-1 hover:bg-paper-deep/40">
            {readOnly ? <span
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-[2.5px]"
              style={{
                borderColor: list.color,
                backgroundColor: item.checked ? list.color : 'transparent'
              }}
            >
              {item.checked && <CheckIcon size={18} style={{ color: textOn(list.color) }} />}
            </span> : <button
              type="button"
              onClick={() => mutations.toggleItem.mutate({ id: item.id })}
              className="pressable flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-[2.5px]"
              style={{ borderColor: list.color, backgroundColor: item.checked ? list.color : 'transparent' }}
              aria-label={item.checked ? 'Uncheck' : 'Check'}
            >
              {item.checked && <CheckIcon size={18} style={{ color: textOn(list.color) }} />}
            </button>}
            <span className={`min-w-0 flex-1 text-lg font-semibold ${item.checked ? 'text-ink-faint line-through' : ''}`}>
              {item.text}
            </span>
            {!readOnly && <button
              type="button"
              onClick={() => mutations.removeItem.mutate({ id: item.id })}
              className="pressable flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-ink-faint opacity-0 transition-opacity group-hover:opacity-100 hover:bg-paper-deep"
              aria-label="Delete item"
            >
              <XIcon size={16} />
            </button>}
          </div>
        ))}
        {list.items.length === 0 && <p className="px-1 py-2 text-base font-semibold text-ink-faint">Nothing here yet</p>}
      </div>
      {!readOnly && checkedCount > 0 && (
        <button
          type="button"
          onClick={() => mutations.clearChecked.mutate({ listId: list.id })}
          className="pressable mt-2 self-start rounded-full border-2 border-line px-3.5 py-1.5 text-sm font-bold text-ink-soft"
        >
          Clear {checkedCount} done
        </button>
      )}
      {!readOnly && <AddItemRow listId={list.id} />}
    </div>
  )
}

export function ListsView() {
  const { data: lists = [] } = useLists()
  const mutations = useListMutations()
  const [editing, setEditing] = useState<ListDto | 'new' | null>(null)
  const [name, setName] = useState('')
  const [color, setColor] = useState<string>(PERSON_COLORS[4])
  const [kind, setKind] = useState<ListKind>('grocery')
  const readOnly = isDisplayClient()

  const openEditor = (l: ListDto | 'new'): void => {
    setEditing(l)
    setName(l === 'new' ? '' : l.name)
    setColor(l === 'new' ? PERSON_COLORS[(lists.length + 4) % PERSON_COLORS.length] : l.color)
    setKind(l === 'new' ? 'grocery' : l.kind)
  }

  const save = (): void => {
    if (!name.trim()) return
    if (editing === 'new') mutations.create.mutate({ name: name.trim(), color, kind })
    else if (editing) mutations.update.mutate({ id: editing.id, name: name.trim(), color })
    setEditing(null)
  }

  return (
    <div className="flex h-full items-start gap-4 overflow-x-auto px-6 pb-6">
      {lists.map((list, i) => (
        <div key={list.id} className="animate-rise flex max-h-full" style={{ animationDelay: `${i * 60}ms` }}>
          <ListCard list={list} readOnly={readOnly} />
        </div>
      ))}
      {!readOnly && <button
        type="button"
        onClick={() => openEditor('new')}
        className="animate-rise pressable flex h-44 w-64 shrink-0 flex-col items-center justify-center gap-2 rounded-card border-2 border-dashed border-line text-ink-faint hover:bg-paper-deep/40"
        style={{ animationDelay: `${lists.length * 60}ms` }}
      >
        <PlusIcon size={28} />
        <span className="text-lg font-bold">New list</span>
      </button>}

      {!readOnly && <Dialog open={editing !== null} onClose={() => setEditing(null)} title={editing === 'new' ? 'New list' : 'Edit list'}>
        <div className="flex flex-col gap-4">
          <div>
            <FieldLabel>Name</FieldLabel>
            <OskInput value={name} onChange={setName} placeholder="e.g. Groceries" autoFocus={editing === 'new'} />
          </div>
          {editing === 'new' && (
            <div>
              <FieldLabel>Type</FieldLabel>
              <SegmentedControl
                value={kind}
                onChange={setKind}
                options={[
                  { value: 'grocery', label: 'Groceries' },
                  { value: 'todo', label: 'To-do' },
                  { value: 'custom', label: 'Other' }
                ]}
              />
            </div>
          )}
          <div>
            <FieldLabel>Color</FieldLabel>
            <div className="flex flex-wrap gap-2">
              {PERSON_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={`pressable h-12 w-12 rounded-full ${color === c ? 'ring-4 ring-ink ring-offset-2 ring-offset-card' : ''}`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>
          <div className="mt-1 flex gap-3">
            {editing !== 'new' && editing && (
              <BigButton
                variant="danger"
                onClick={() => {
                  mutations.remove.mutate({ id: editing.id })
                  setEditing(null)
                }}
              >
                Delete
              </BigButton>
            )}
            <div className="flex-1" />
            <BigButton variant="ghost" onClick={() => setEditing(null)}>
              Cancel
            </BigButton>
            <BigButton onClick={save} disabled={!name.trim()}>
              Save
            </BigButton>
          </div>
        </div>
      </Dialog>}
    </div>
  )
}
