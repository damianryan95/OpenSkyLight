import type { IpcChannel } from './contract'

/**
 * The ONLY channels the companion HTTP API will dispatch. Everything else
 * (settings, auth, screensaver, updater…) returns 404 even
 * with a valid bearer token — a paired phone edits family data, it does not
 * administer the kiosk.
 */
export const COMPANION_CHANNELS: ReadonlySet<IpcChannel> = new Set<IpcChannel>([
  'lists:getAll',
  'lists:create',
  'lists:update',
  'lists:delete',
  'listItems:add',
  'listItems:toggle',
  'listItems:delete',
  'listItems:clearChecked',
  'meals:getRange',
  'meals:set',
  'chores:list',
  'chores:create',
  'chores:update',
  'chores:getDay',
  'chores:complete',
  'chores:uncomplete',
  'stars:balances',
  'events:getOccurrences',
  'people:list'
])
