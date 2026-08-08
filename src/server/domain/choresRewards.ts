import { randomUUID } from 'node:crypto'
import { DateTime } from 'luxon'
import { RRule } from 'rrule'
import type Database from 'better-sqlite3'

export type CompletionActor = 'display' | 'parent'

export interface ChoreCompletionCommand {
  choreId: string
  dueDate: string
  actor: CompletionActor
  /**
   * The household's current local date as authorized by the caller. Display
   * commands must supply it; parent commands intentionally may target history.
   */
  authorizedDate?: string
  initiatingDeviceId?: string
}

export interface CreateChoreInput {
  title: string
  icon?: string | null
  personId: string
  starsValue: number
  dueDate: string
  scheduleRrule?: string | null
  routine?: 'morning' | 'evening' | null
}

export interface CreateRewardInput {
  title: string
  icon?: string | null
  costStars: number
}

export interface CompletionResult {
  completionId: string
  balance: number
  created: boolean
}

export interface ChoreCompletedEvent {
  type: 'chore.completed'
  completionId: string
  choreId: string
  personId: string
  stars: number
  completedAt: string
  initiatingDeviceId?: string
}

export type ChoreCompletedPublisher = (event: ChoreCompletedEvent) => void

export interface StarAdjustmentInput {
  personId: string
  delta: number
}

export interface UpdateChoreInput {
  id: string
  title?: string
  icon?: string | null
  personId?: string
  starsValue?: number
  dueDate?: string
  scheduleRrule?: string | null
  routine?: 'morning' | 'evening' | null
  active?: boolean
}

export interface UpdateRewardInput { id: string; title?: string; icon?: string | null; costStars?: number; active?: boolean }

export interface AdminChoreDto {
  id: string; title: string; icon: string | null; personId: string; starsValue: number; dueDate: string; scheduleRrule: string | null
  routine: 'morning' | 'evening' | null; active: boolean
}
export interface AdminRewardDto { id: string; title: string; icon: string | null; costStars: number; active: boolean }
export interface RedemptionDto { id: string; rewardId: string; personId: string; starsSpent: number; redeemedAt: string; status: 'pending' | 'granted' | 'cancelled'; rewardTitle: string }

interface ChoreRow {
  id: string
  person_id: string | null
  stars_value: number
  due_date: string | null
  schedule_rrule: string | null
  active: number
  deleted_at: string | null
}

interface CompletionRow {
  id: string
  person_id: string
}

interface RewardRow {
  id: string
  cost_stars: number
}

interface AdminChoreRow extends ChoreRow { title: string; icon: string | null; due_date: string | null; routine: 'morning' | 'evening' | null }
interface AdminRewardRow extends RewardRow { title: string; icon: string | null; active: number; deleted_at: string | null }

function assertCalendarDate(value: string, field: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !DateTime.fromISO(value, { zone: 'utc' }).isValid) {
    throw new Error(`${field} must be an ISO calendar date`)
  }
}

function assertDisplayDateAuthorization(command: ChoreCompletionCommand): void {
  assertCalendarDate(command.dueDate, 'dueDate')
  if (command.actor !== 'display') return
  if (!command.authorizedDate) throw new Error('Display chore commands require an authorizedDate')
  assertCalendarDate(command.authorizedDate, 'authorizedDate')
  if (command.dueDate !== command.authorizedDate) {
    throw new Error('Displays may only change chores for the authorized household date')
  }
}

function recurrenceDueOn(chore: ChoreRow, date: string): boolean {
  if (!chore.due_date) return false
  if (!chore.schedule_rrule) return chore.due_date === date
  if (date < chore.due_date) return false

  try {
    const parsed = RRule.parseString(chore.schedule_rrule)
    parsed.dtstart = new Date(`${chore.due_date}T00:00:00.000Z`)
    const rule = new RRule(parsed)
    const start = new Date(`${date}T00:00:00.000Z`)
    const end = new Date(`${date}T23:59:59.999Z`)
    return rule.between(start, end, true).length > 0
  } catch {
    return false
  }
}

/**
 * SQLite-backed household domain service. Its caller supplies authorization
 * context and dates, leaving HTTP, sessions, and device policy to later layers.
 */
export function createChoresRewardsService(
  sqlite: Database.Database,
  now: () => string = () => new Date().toISOString(),
  publishCompleted?: ChoreCompletedPublisher
) {
  const balanceStatement = sqlite.prepare('SELECT COALESCE(SUM(delta), 0) AS balance FROM star_ledger WHERE person_id = ?')
  const findChore = sqlite.prepare< [string], ChoreRow >(
    'SELECT id, person_id, stars_value, due_date, schedule_rrule, active, deleted_at FROM chores WHERE id = ?'
  )
  const findCompletion = sqlite.prepare<[string, string], CompletionRow>(
    'SELECT id, person_id FROM chore_completions WHERE chore_id = ? AND due_date = ?'
  )

  function balanceOf(personId: string): number {
    return (balanceStatement.get(personId) as { balance: number }).balance
  }

  function createChore(input: CreateChoreInput): string {
    assertCalendarDate(input.dueDate, 'dueDate')
    if (!input.title.trim()) throw new Error('Chore title is required')
    if (!Number.isInteger(input.starsValue) || input.starsValue < 0) throw new Error('starsValue must be a non-negative integer')
    const id = randomUUID()
    sqlite
      .prepare(
        'INSERT INTO chores (id, title, icon, person_id, stars_value, schedule_rrule, due_date, routine, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .run(id, input.title.trim(), input.icon ?? null, input.personId, input.starsValue, input.scheduleRrule ?? null, input.dueDate, input.routine ?? null, now())
    return id
  }

  function choreDto(row: AdminChoreRow): AdminChoreDto {
    if (!row.person_id || !row.due_date) throw new Error('Chore is incomplete')
    return { id: row.id, title: row.title, icon: row.icon, personId: row.person_id, starsValue: row.stars_value, dueDate: row.due_date, scheduleRrule: row.schedule_rrule, routine: row.routine, active: row.active === 1 }
  }
  function listChores(): AdminChoreDto[] {
    return sqlite.prepare<[], AdminChoreRow>('SELECT id, title, icon, person_id, stars_value, due_date, schedule_rrule, routine, active, deleted_at FROM chores WHERE deleted_at IS NULL ORDER BY sort_order, created_at').all().map(choreDto)
  }
  function updateChore(input: UpdateChoreInput): AdminChoreDto {
    if (Object.keys(input).length === 1) throw new Error('At least one chore field is required')
    if (input.title !== undefined && !input.title.trim()) throw new Error('Chore title is required')
    if (input.starsValue !== undefined && (!Number.isInteger(input.starsValue) || input.starsValue < 0)) throw new Error('starsValue must be a non-negative integer')
    if (input.dueDate !== undefined) assertCalendarDate(input.dueDate, 'dueDate')
    const fields: string[] = []; const values: unknown[] = []
    const add = (column: string, value: unknown) => { if (value !== undefined) { fields.push(`${column} = ?`); values.push(value) } }
    add('title', input.title?.trim()); add('icon', input.icon); add('person_id', input.personId); add('stars_value', input.starsValue); add('due_date', input.dueDate); add('schedule_rrule', input.scheduleRrule); add('routine', input.routine); add('active', input.active === undefined ? undefined : input.active ? 1 : 0)
    const changed = sqlite.prepare(`UPDATE chores SET ${fields.join(', ')} WHERE id = ? AND deleted_at IS NULL`).run(...values, input.id).changes
    if (changed === 0) throw new Error('Chore not found')
    return choreDto(sqlite.prepare<[string], AdminChoreRow>('SELECT id, title, icon, person_id, stars_value, due_date, schedule_rrule, routine, active, deleted_at FROM chores WHERE id = ?').get(input.id)!)
  }
  function archiveChore(id: string): void {
    if (sqlite.prepare('UPDATE chores SET deleted_at = ?, active = 0 WHERE id = ? AND deleted_at IS NULL').run(now(), id).changes === 0) throw new Error('Chore not found')
  }

  function isDueOn(choreId: string, date: string): boolean {
    assertCalendarDate(date, 'date')
    const chore = findChore.get(choreId)
    return Boolean(chore && chore.active === 1 && !chore.deleted_at && recurrenceDueOn(chore, date))
  }

  const completeTransaction = sqlite.transaction((command: ChoreCompletionCommand): { result: CompletionResult; event?: ChoreCompletedEvent } => {
    const chore = findChore.get(command.choreId)
    if (!chore || chore.deleted_at || chore.active !== 1 || !chore.person_id) throw new Error('Chore not found or inactive')
    if (!recurrenceDueOn(chore, command.dueDate)) throw new Error('Chore is not due on this date')

    const existing = findCompletion.get(command.choreId, command.dueDate)
    if (existing) return { result: { completionId: existing.id, balance: balanceOf(existing.person_id), created: false } }

    const completionId = randomUUID()
    const occurredAt = now()
    sqlite
      .prepare(
        'INSERT INTO chore_completions (id, chore_id, person_id, due_date, completed_at, stars_awarded) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run(completionId, chore.id, chore.person_id, command.dueDate, occurredAt, chore.stars_value)
    sqlite
      .prepare('INSERT INTO star_ledger (id, person_id, delta, reason, chore_completion_id, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(randomUUID(), chore.person_id, chore.stars_value, 'chore', completionId, occurredAt)
    return {
      result: { completionId, balance: balanceOf(chore.person_id), created: true },
      event: {
        type: 'chore.completed',
        completionId,
        choreId: chore.id,
        personId: chore.person_id,
        stars: chore.stars_value,
        completedAt: occurredAt,
        ...(command.initiatingDeviceId ? { initiatingDeviceId: command.initiatingDeviceId } : {})
      }
    }
  })

  function complete(command: ChoreCompletionCommand): CompletionResult {
    assertDisplayDateAuthorization(command)
    const operation = completeTransaction(command)
    if (operation.event && publishCompleted) {
      // Celebration delivery is deliberately best-effort: a notification
      // failure must never roll back a committed household completion.
      try {
        publishCompleted(operation.event)
      } catch {
        // The event stream owns any diagnostics/retry policy in a later layer.
      }
    }
    return operation.result
  }

  const undoTransaction = sqlite.transaction((command: ChoreCompletionCommand): CompletionResult => {
    const completion = findCompletion.get(command.choreId, command.dueDate)
    if (!completion) {
      const chore = findChore.get(command.choreId)
      if (!chore?.person_id) throw new Error('Chore not found')
      return { completionId: '', balance: balanceOf(chore.person_id), created: false }
    }
    sqlite.prepare('DELETE FROM star_ledger WHERE chore_completion_id = ?').run(completion.id)
    sqlite.prepare('DELETE FROM chore_completions WHERE id = ?').run(completion.id)
    return { completionId: completion.id, balance: balanceOf(completion.person_id), created: true }
  })

  function undo(command: ChoreCompletionCommand): CompletionResult {
    assertDisplayDateAuthorization(command)
    return undoTransaction(command)
  }

  function createReward(input: CreateRewardInput): string {
    if (!input.title.trim()) throw new Error('Reward title is required')
    if (!Number.isInteger(input.costStars) || input.costStars <= 0) throw new Error('costStars must be a positive integer')
    const id = randomUUID()
    sqlite.prepare('INSERT INTO rewards (id, title, icon, cost_stars, created_at) VALUES (?, ?, ?, ?, ?)').run(id, input.title.trim(), input.icon ?? null, input.costStars, now())
    return id
  }

  function rewardDto(row: AdminRewardRow): AdminRewardDto { return { id: row.id, title: row.title, icon: row.icon, costStars: row.cost_stars, active: row.active === 1 } }
  function listRewards(): AdminRewardDto[] { return sqlite.prepare<[], AdminRewardRow>('SELECT id, title, icon, cost_stars, active, deleted_at FROM rewards WHERE deleted_at IS NULL ORDER BY sort_order, created_at').all().map(rewardDto) }
  function updateReward(input: UpdateRewardInput): AdminRewardDto {
    if (Object.keys(input).length === 1) throw new Error('At least one reward field is required')
    if (input.title !== undefined && !input.title.trim()) throw new Error('Reward title is required')
    if (input.costStars !== undefined && (!Number.isInteger(input.costStars) || input.costStars <= 0)) throw new Error('costStars must be a positive integer')
    const fields: string[] = []; const values: unknown[] = []
    const add = (column: string, value: unknown) => { if (value !== undefined) { fields.push(`${column} = ?`); values.push(value) } }
    add('title', input.title?.trim()); add('icon', input.icon); add('cost_stars', input.costStars); add('active', input.active === undefined ? undefined : input.active ? 1 : 0)
    if (sqlite.prepare(`UPDATE rewards SET ${fields.join(', ')} WHERE id = ? AND deleted_at IS NULL`).run(...values, input.id).changes === 0) throw new Error('Reward not found')
    return rewardDto(sqlite.prepare<[string], AdminRewardRow>('SELECT id, title, icon, cost_stars, active, deleted_at FROM rewards WHERE id = ?').get(input.id)!)
  }
  function archiveReward(id: string): void { if (sqlite.prepare('UPDATE rewards SET deleted_at = ?, active = 0 WHERE id = ? AND deleted_at IS NULL').run(now(), id).changes === 0) throw new Error('Reward not found') }

  const redeemTransaction = sqlite.transaction((rewardId: string, personId: string): string => {
    const reward = sqlite.prepare<[string], RewardRow>('SELECT id, cost_stars FROM rewards WHERE id = ? AND active = 1 AND deleted_at IS NULL').get(rewardId)
    if (!reward) throw new Error('Reward not found or inactive')
    if (balanceOf(personId) < reward.cost_stars) throw new Error('Not enough stars')
    const redemptionId = randomUUID()
    const redeemedAt = now()
    sqlite.prepare('INSERT INTO reward_redemptions (id, reward_id, person_id, stars_spent, redeemed_at) VALUES (?, ?, ?, ?, ?)').run(redemptionId, reward.id, personId, reward.cost_stars, redeemedAt)
    sqlite.prepare('INSERT INTO star_ledger (id, person_id, delta, reason, reward_redemption_id, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(randomUUID(), personId, -reward.cost_stars, 'redemption', redemptionId, redeemedAt)
    return redemptionId
  })

  function redeem(rewardId: string, personId: string): string {
    return redeemTransaction(rewardId, personId)
  }

  function listRedemptions(): RedemptionDto[] {
    return sqlite.prepare<[], { id: string; reward_id: string; person_id: string; stars_spent: number; redeemed_at: string; status: 'pending' | 'granted' | 'cancelled'; reward_title: string }>('SELECT rr.id, rr.reward_id, rr.person_id, rr.stars_spent, rr.redeemed_at, rr.status, r.title AS reward_title FROM reward_redemptions rr JOIN rewards r ON r.id = rr.reward_id ORDER BY rr.redeemed_at DESC').all().map((row) => ({ id: row.id, rewardId: row.reward_id, personId: row.person_id, starsSpent: row.stars_spent, redeemedAt: row.redeemed_at, status: row.status, rewardTitle: row.reward_title }))
  }
  function grantRedemption(id: string): void { if (sqlite.prepare("UPDATE reward_redemptions SET status = 'granted' WHERE id = ? AND status = 'pending'").run(id).changes === 0) throw new Error('Redemption not found') }

  function adjustStars(input: StarAdjustmentInput): number {
    if (!Number.isInteger(input.delta) || input.delta === 0) throw new Error('delta must be a non-zero integer')
    return sqlite.transaction(() => {
      sqlite.prepare('INSERT INTO star_ledger (id, person_id, delta, reason, created_at) VALUES (?, ?, ?, ?, ?)').run(randomUUID(), input.personId, input.delta, 'manual_adjust', now())
      return balanceOf(input.personId)
    })()
  }

  return { createChore, listChores, updateChore, archiveChore, isDueOn, complete, undo, balanceOf, createReward, listRewards, updateReward, archiveReward, redeem, listRedemptions, grantRedemption, adjustStars }
}

export type ChoresRewardsService = ReturnType<typeof createChoresRewardsService>
