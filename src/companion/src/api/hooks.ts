import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ChoreCreateInput, ChoreUpdateInput } from '@shared/types'
import type { AuthoredEventDto, EventDraftDto, EventScope, UpdateEventRequest } from '@shared/api/contract'
import { parentMutation, rpc } from './client'

/** Phone tabs get suspended constantly — focus/reconnect refetch is the real
 * freshness mechanism; the 20s interval covers a phone left on the counter. */
const LIVE = { refetchInterval: 20_000, refetchOnWindowFocus: true, refetchOnReconnect: true } as const

export function usePeople() {
  return useQuery({ queryKey: ['people'], queryFn: () => rpc('people:list', undefined), ...LIVE })
}

export function useLists() {
  return useQuery({ queryKey: ['lists'], queryFn: () => rpc('lists:getAll', undefined), ...LIVE })
}

export function useMeals(start: string, end: string) {
  return useQuery({
    queryKey: ['meals', start, end],
    queryFn: () => rpc('meals:getRange', { start, end }),
    ...LIVE
  })
}

export function useChoresDay(date: string) {
  return useQuery({ queryKey: ['choresDay', date], queryFn: () => rpc('chores:getDay', { date }), ...LIVE })
}

export function useChores() {
  return useQuery({ queryKey: ['chores'], queryFn: () => rpc('chores:list', undefined), ...LIVE })
}

export function useBalances() {
  return useQuery({ queryKey: ['balances'], queryFn: () => rpc('stars:balances', undefined), ...LIVE })
}

export function useOccurrences(start: string, end: string) {
  return useQuery({
    queryKey: ['occurrences', start, end],
    queryFn: () => rpc('events:getOccurrences', { start, end }),
    ...LIVE
  })
}

export function useInvalidatingMutation<TInput, TOutput>(
  fn: (input: TInput) => Promise<TOutput>,
  keys: string[][]
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      for (const key of keys) void queryClient.invalidateQueries({ queryKey: key })
    }
  })
}

export function useListMutations() {
  const keys = [['lists']]
  return {
    create: useInvalidatingMutation(
      (input: { name: string; color: string; kind: 'grocery' | 'todo' | 'custom' }) => rpc('lists:create', input),
      keys
    ),
    addItem: useInvalidatingMutation((input: { listId: string; text: string }) => rpc('listItems:add', input), keys),
    toggleItem: useInvalidatingMutation((input: { id: string }) => rpc('listItems:toggle', input), keys),
    clearChecked: useInvalidatingMutation((input: { listId: string }) => rpc('listItems:clearChecked', input), keys)
  }
}

export function useMealMutations() {
  return {
    set: useInvalidatingMutation(
      (input: { date: string; slot: 'breakfast' | 'lunch' | 'dinner'; text: string | null }) =>
        rpc('meals:set', input),
      [['meals']]
    )
  }
}

/**
 * Authoring events from the parent's phone (`N06`).
 *
 * `scope` is what keeps a series intact: editing one occurrence records an
 * override for that date, and only `series` touches the repeating event itself.
 */
export function useEventMutations() {
  const keys = [['occurrences'], ['syncStatus']]
  return {
    create: useInvalidatingMutation((input: EventDraftDto) => parentMutation<AuthoredEventDto>('/api/v1/calendar-events', 'POST', input), keys),
    update: useInvalidatingMutation(
      (input: { id: string; patch: UpdateEventRequest; scope?: EventScope; occurrenceStart?: string }) =>
        parentMutation<AuthoredEventDto>(`/api/v1/calendar-events/${encodeURIComponent(input.id)}${eventScopeQuery(input)}`, 'PATCH', input.patch),
      keys
    ),
    remove: useInvalidatingMutation(
      (input: { id: string; scope?: EventScope; occurrenceStart?: string }) =>
        parentMutation<void>(`/api/v1/calendar-events/${encodeURIComponent(input.id)}${eventScopeQuery(input)}`, 'DELETE'),
      keys
    )
  }
}

function eventScopeQuery(input: { scope?: EventScope; occurrenceStart?: string }): string {
  if (input.scope !== 'occurrence' || input.occurrenceStart === undefined) return ''
  return `?scope=occurrence&occurrenceStart=${encodeURIComponent(input.occurrenceStart)}`
}

export function useChoreMutations() {
  const keys = [['choresDay'], ['chores'], ['balances']]
  return {
    create: useInvalidatingMutation((input: ChoreCreateInput) => rpc('chores:create', input), keys),
    update: useInvalidatingMutation((input: ChoreUpdateInput) => rpc('chores:update', input), keys),
    complete: useInvalidatingMutation((input: { choreId: string; date: string }) => rpc('chores:complete', input), keys),
    uncomplete: useInvalidatingMutation(
      (input: { choreId: string; date: string }) => rpc('chores:uncomplete', input),
      keys
    )
  }
}
