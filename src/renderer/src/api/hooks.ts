import { useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ipcInvoke, subscribePush } from './client'
import type {
  CalendarCreateInput,
  CalendarUpdateInput,
  PersonCreateInput,
  PersonUpdateInput,
  AppSettings
} from '@shared/types'
import type { DateRange } from '@shared/dates'
import { useToasts } from '../stores/toastStore'

export function useAppInfo() {
  return useQuery({ queryKey: ['appInfo'], queryFn: () => ipcInvoke('app:getInfo', undefined), staleTime: Infinity })
}

export function useSettings() {
  return useQuery({ queryKey: ['settings'], queryFn: () => ipcInvoke('settings:getAll', undefined) })
}

export function usePeople() {
  return useQuery({ queryKey: ['people'], queryFn: () => ipcInvoke('people:list', undefined) })
}

export function useCalendars() {
  return useQuery({ queryKey: ['calendars'], queryFn: () => ipcInvoke('calendars:list', undefined) })
}

export function useEventDetail(id: string | null) {
  return useQuery({
    queryKey: ['event', id],
    queryFn: () => ipcInvoke('events:get', { id: id! }),
    enabled: id !== null
  })
}

export function useOccurrences(range: DateRange) {
  return useQuery({
    queryKey: ['occurrences', range.start, range.end],
    queryFn: () => ipcInvoke('events:getOccurrences', { start: range.start, end: range.end }),
    placeholderData: (prev) => prev
  })
}

function useInvalidatingMutation<TInput, TOutput>(
  fn: (input: TInput) => Promise<TOutput>,
  keys: string[][]
) {
  const queryClient = useQueryClient()
  const pushToast = useToasts((s) => s.push)
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      for (const key of keys) void queryClient.invalidateQueries({ queryKey: key })
    },
    onError: (err: Error) => pushToast(err.message)
  })
}

export function usePeopleMutations() {
  const keys = [['people'], ['occurrences']]
  return {
    create: useInvalidatingMutation((input: PersonCreateInput) => ipcInvoke('people:create', input), keys),
    update: useInvalidatingMutation((input: PersonUpdateInput) => ipcInvoke('people:update', input), keys),
    remove: useInvalidatingMutation((input: { id: string }) => ipcInvoke('people:delete', input), keys)
  }
}

export function useCalendarMutations() {
  const keys = [['calendars'], ['occurrences']]
  return {
    create: useInvalidatingMutation((input: CalendarCreateInput) => ipcInvoke('calendars:create', input), keys),
    update: useInvalidatingMutation((input: CalendarUpdateInput) => ipcInvoke('calendars:update', input), keys),
    remove: useInvalidatingMutation((input: { id: string }) => ipcInvoke('calendars:delete', input), keys)
  }
}

export function useSettingsMutation() {
  return useInvalidatingMutation(
    (patch: Partial<AppSettings>) => ipcInvoke('settings:set', { patch }),
    [['settings'], ['occurrences'], ['weather']]
  )
}

export function useGoogleStatus() {
  return useQuery({ queryKey: ['googleStatus'], queryFn: () => ipcInvoke('google:getStatus', undefined) })
}

export function useRemoteCalendars(accountId: string | null) {
  return useQuery({
    queryKey: ['remoteCalendars', accountId],
    queryFn: () => ipcInvoke('google:listRemoteCalendars', { accountId: accountId! }),
    enabled: accountId !== null,
    staleTime: 60_000
  })
}

export function useSyncStatus() {
  return useQuery({
    queryKey: ['syncStatus'],
    queryFn: () => ipcInvoke('sync:getStatus', undefined),
    refetchInterval: 15_000
  })
}

export function useGoogleMutations() {
  const calendarKeys = [['googleStatus'], ['remoteCalendars'], ['calendars'], ['occurrences'], ['syncStatus']]
  return {
    setCredentials: useInvalidatingMutation(
      (input: { clientId: string; clientSecret: string }) => ipcInvoke('google:setCredentials', input),
      [['googleStatus']]
    ),
    connect: useInvalidatingMutation(() => ipcInvoke('google:connect', undefined), calendarKeys),
    disconnect: useInvalidatingMutation(
      (input: { accountId: string }) => ipcInvoke('google:disconnect', input),
      calendarKeys
    ),
    setCalendarSelected: useInvalidatingMutation(
      (input: {
        accountId: string
        googleCalendarId: string
        name: string
        color: string
        readOnly: boolean
        selected: boolean
      }) => ipcInvoke('google:setCalendarSelected', input),
      calendarKeys
    )
  }
}

export function useIcsMutations() {
  return {
    add: useInvalidatingMutation(
      (input: { url: string; name: string; color: string }) => ipcInvoke('ics:add', input),
      [['calendars'], ['occurrences'], ['syncStatus']]
    )
  }
}

export function useSyncNow() {
  return useInvalidatingMutation(() => ipcInvoke('sync:now', undefined), [['syncStatus']])
}

export function useChores() {
  return useQuery({ queryKey: ['chores'], queryFn: () => ipcInvoke('chores:list', undefined) })
}

export function useChoresDay(date: string) {
  return useQuery({
    queryKey: ['choresDay', date],
    queryFn: () => ipcInvoke('chores:getDay', { date }),
    placeholderData: (prev) => prev
  })
}

export function useBalances() {
  return useQuery({ queryKey: ['balances'], queryFn: () => ipcInvoke('stars:balances', undefined) })
}

export function useChoreMutations() {
  const defKeys = [['chores'], ['choresDay']]
  const checkKeys = [['choresDay'], ['balances']]
  return {
    create: useInvalidatingMutation(
      (input: Parameters<typeof ipcInvoke<'chores:create'>>[1]) => ipcInvoke('chores:create', input),
      defKeys
    ),
    update: useInvalidatingMutation(
      (input: Parameters<typeof ipcInvoke<'chores:update'>>[1]) => ipcInvoke('chores:update', input),
      defKeys
    ),
    remove: useInvalidatingMutation((input: { id: string }) => ipcInvoke('chores:delete', input), defKeys),
    complete: useInvalidatingMutation(
      (input: { choreId: string; date: string }) => ipcInvoke('chores:complete', input),
      checkKeys
    ),
    uncomplete: useInvalidatingMutation(
      (input: { choreId: string; date: string }) => ipcInvoke('chores:uncomplete', input),
      checkKeys
    )
  }
}

export function useRewards() {
  return useQuery({ queryKey: ['rewards'], queryFn: () => ipcInvoke('rewards:list', undefined) })
}

export function useRedemptions() {
  return useQuery({ queryKey: ['redemptions'], queryFn: () => ipcInvoke('rewards:redemptions', undefined) })
}

export function useRewardMutations() {
  return {
    create: useInvalidatingMutation(
      (input: { title: string; costStars: number }) => ipcInvoke('rewards:create', input),
      [['rewards']]
    ),
    update: useInvalidatingMutation(
      (input: { id: string; title?: string; costStars?: number; active?: boolean }) =>
        ipcInvoke('rewards:update', input),
      [['rewards']]
    ),
    remove: useInvalidatingMutation((input: { id: string }) => ipcInvoke('rewards:delete', input), [['rewards']]),
    redeem: useInvalidatingMutation(
      (input: { rewardId: string; personId: string }) => ipcInvoke('rewards:redeem', input),
      [['balances'], ['redemptions']]
    ),
    grant: useInvalidatingMutation(
      (input: { redemptionId: string }) => ipcInvoke('rewards:grant', input),
      [['redemptions']]
    )
  }
}

export function useLists() {
  return useQuery({ queryKey: ['lists'], queryFn: () => ipcInvoke('lists:getAll', undefined) })
}

export function useListMutations() {
  const keys = [['lists']]
  return {
    create: useInvalidatingMutation(
      (input: Parameters<typeof ipcInvoke<'lists:create'>>[1]) => ipcInvoke('lists:create', input),
      keys
    ),
    update: useInvalidatingMutation(
      (input: { id: string; name?: string; color?: string }) => ipcInvoke('lists:update', input),
      keys
    ),
    remove: useInvalidatingMutation((input: { id: string }) => ipcInvoke('lists:delete', input), keys),
    addItem: useInvalidatingMutation(
      (input: { listId: string; text: string }) => ipcInvoke('listItems:add', input),
      keys
    ),
    toggleItem: useInvalidatingMutation((input: { id: string }) => ipcInvoke('listItems:toggle', input), keys),
    removeItem: useInvalidatingMutation((input: { id: string }) => ipcInvoke('listItems:delete', input), keys),
    clearChecked: useInvalidatingMutation(
      (input: { listId: string }) => ipcInvoke('listItems:clearChecked', input),
      keys
    )
  }
}

export function useMeals(start: string, end: string) {
  return useQuery({
    queryKey: ['meals', start, end],
    queryFn: () => ipcInvoke('meals:getRange', { start, end }),
    placeholderData: (prev) => prev
  })
}

export function useMealMutations() {
  return {
    set: useInvalidatingMutation(
      (input: Parameters<typeof ipcInvoke<'meals:set'>>[1]) => ipcInvoke('meals:set', input),
      [['meals']]
    )
  }
}

export function useWeather() {
  return useQuery({
    queryKey: ['weather'],
    queryFn: () => ipcInvoke('weather:get', undefined),
    refetchInterval: 10 * 60_000,
    retry: 2
  })
}

export function useCitySearch() {
  return useMutation({
    mutationFn: (query: string) => ipcInvoke('weather:searchCity', { query })
  })
}

export function useAuthStatus() {
  return useQuery({ queryKey: ['authStatus'], queryFn: () => ipcInvoke('auth:getStatus', undefined) })
}

export function useAuthMutations() {
  const keys = [['authStatus']]
  return {
    verifyPin: useInvalidatingMutation((input: { pin: string }) => ipcInvoke('auth:verifyPin', input), keys),
    setPin: useInvalidatingMutation((input: { pin: string | null }) => ipcInvoke('auth:setPin', input), keys),
    lock: useInvalidatingMutation(() => ipcInvoke('auth:lock', undefined), keys)
  }
}

export function useCompanionStatus() {
  return useQuery({
    queryKey: ['companionStatus'],
    queryFn: () => ipcInvoke('companion:getStatus', undefined),
    refetchInterval: 5_000 // cheap local IPC; tracks server start/stop + pair count
  })
}

export function useCompanionMutations() {
  const keys = [['companionStatus']]
  return {
    issueToken: useInvalidatingMutation(() => ipcInvoke('companion:issueToken', undefined), keys),
    unpairAll: useInvalidatingMutation(() => ipcInvoke('companion:unpairAll', undefined), keys)
  }
}

/** Refetch when the main process announces data changes (sync engine, other windows). */
export function usePushInvalidation(): void {
  const queryClient = useQueryClient()
  useEffect(() => {
    const offData = subscribePush('push:dataChanged', (data) => {
      const domain = (data as { domain?: string })?.domain
      if (domain === 'events') void queryClient.invalidateQueries({ queryKey: ['occurrences'] })
      else if (domain) void queryClient.invalidateQueries({ queryKey: [domain] })
      if (domain === 'calendars') void queryClient.invalidateQueries({ queryKey: ['occurrences'] })
      if (domain === 'chores') {
        // chore day views and star balances key off their own roots
        void queryClient.invalidateQueries({ queryKey: ['choresDay'] })
        void queryClient.invalidateQueries({ queryKey: ['balances'] })
        // A display can receive this notification while its view is changing.
        // Refetch active queries explicitly so a completed chore converges on
        // every wall display even when React Query has just marked a query
        // inactive during that transition.
        void queryClient.refetchQueries({ queryKey: ['choresDay'], type: 'active' })
        void queryClient.refetchQueries({ queryKey: ['balances'], type: 'active' })
      }
    })
    const offStatus = subscribePush('push:syncStatus', () => {
      void queryClient.invalidateQueries({ queryKey: ['syncStatus'] })
    })
    // The stream server explicitly asks clients to revalidate after every
    // (re)connection so a missed event never leaves a kiosk stale.
    const offReconnect = subscribePush('push:streamRevalidated', () => {
      void queryClient.invalidateQueries()
    })
    return () => {
      offData()
      offStatus()
      offReconnect()
    }
  }, [queryClient])
}
