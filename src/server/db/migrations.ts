import type Database from 'better-sqlite3'

/**
 * Ordered, append-only server migrations. This is deliberately a fresh
 * household schema: the Electron application's database is never read or
 * imported by this migration runner.
 */
const migrations: readonly string[] = [
  // 001 - initial server-owned household schema
  `
    CREATE TABLE people (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      color TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('parent', 'child')),
      avatar_path TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      deleted_at TEXT
    );

    -- A connected calendar provider. Provider-agnostic by design: CalDAV
    -- collections, read-only ICS feeds, and phone-native pushes all register
    -- here. Credentials belong to the source implementation, not this table.
    --
    -- 'local' is the board's own calendar (ADR 0007) and is the odd one out: it
    -- has no remote, is never fetched or pushed, and is seeded once in migration
    -- 013. The constraint is amended here rather than in a later migration
    -- because SQLite cannot ALTER a CHECK, and the deployment is greenfield.
    CREATE TABLE calendar_sources (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL CHECK (kind IN ('caldav', 'ics', 'phone', 'local')),
      name TEXT NOT NULL,
      connected_at TEXT NOT NULL,
      last_attempted_at TEXT,
      last_succeeded_at TEXT,
      last_error TEXT,
      deleted_at TEXT
    );

    CREATE TABLE calendars (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL REFERENCES calendar_sources(id) ON DELETE CASCADE,
      source_calendar_id TEXT NOT NULL,
      audience_person_id TEXT REFERENCES people(id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#0091FF',
      selected INTEGER NOT NULL DEFAULT 1 CHECK (selected IN (0, 1)),
      sync_token TEXT,
      last_synced_at TEXT,
      sync_error TEXT,
      deleted_at TEXT,
      UNIQUE (source_id, source_calendar_id)
    );
    CREATE INDEX idx_calendars_audience_person ON calendars(audience_person_id);

    CREATE TABLE events (
      id TEXT PRIMARY KEY,
      calendar_id TEXT NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
      source_event_id TEXT NOT NULL,
      etag TEXT,
      ical_uid TEXT,
      title TEXT NOT NULL DEFAULT '',
      description TEXT,
      location TEXT,
      start_at TEXT NOT NULL,
      end_at TEXT NOT NULL,
      timezone TEXT NOT NULL,
      all_day INTEGER NOT NULL DEFAULT 0 CHECK (all_day IN (0, 1)),
      recurrence TEXT,
      recurring_event_id TEXT,
      original_start_at TEXT,
      status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'cancelled')),
      remote_updated_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (calendar_id, source_event_id)
    );
    CREATE INDEX idx_events_calendar_start ON events(calendar_id, start_at);
    CREATE INDEX idx_events_recurring_event ON events(recurring_event_id);

    CREATE TABLE chores (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      icon TEXT,
      person_id TEXT REFERENCES people(id) ON DELETE SET NULL,
      stars_value INTEGER NOT NULL DEFAULT 1 CHECK (stars_value >= 0),
      schedule_rrule TEXT,
      due_date TEXT,
      routine TEXT CHECK (routine IN ('morning', 'evening')),
      active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      deleted_at TEXT
    );

    CREATE TABLE chore_completions (
      id TEXT PRIMARY KEY,
      chore_id TEXT NOT NULL REFERENCES chores(id) ON DELETE CASCADE,
      person_id TEXT NOT NULL REFERENCES people(id) ON DELETE RESTRICT,
      due_date TEXT NOT NULL,
      completed_at TEXT NOT NULL,
      stars_awarded INTEGER NOT NULL CHECK (stars_awarded >= 0),
      UNIQUE (chore_id, due_date)
    );
    CREATE INDEX idx_chore_completions_person_date ON chore_completions(person_id, due_date);

    CREATE TABLE star_ledger (
      id TEXT PRIMARY KEY,
      person_id TEXT NOT NULL REFERENCES people(id) ON DELETE RESTRICT,
      delta INTEGER NOT NULL,
      reason TEXT NOT NULL CHECK (reason IN ('chore', 'redemption', 'manual_adjust')),
      chore_completion_id TEXT UNIQUE REFERENCES chore_completions(id) ON DELETE RESTRICT,
      reward_redemption_id TEXT UNIQUE REFERENCES reward_redemptions(id) ON DELETE RESTRICT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX idx_star_ledger_person_created ON star_ledger(person_id, created_at);

    CREATE TABLE rewards (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      icon TEXT,
      cost_stars INTEGER NOT NULL CHECK (cost_stars > 0),
      active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      deleted_at TEXT
    );

    CREATE TABLE reward_redemptions (
      id TEXT PRIMARY KEY,
      reward_id TEXT NOT NULL REFERENCES rewards(id) ON DELETE RESTRICT,
      person_id TEXT NOT NULL REFERENCES people(id) ON DELETE RESTRICT,
      stars_spent INTEGER NOT NULL CHECK (stars_spent > 0),
      redeemed_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'granted', 'cancelled'))
    );
    CREATE INDEX idx_reward_redemptions_person ON reward_redemptions(person_id, redeemed_at);

    CREATE TABLE lists (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#0091FF',
      kind TEXT NOT NULL DEFAULT 'custom' CHECK (kind IN ('grocery', 'todo', 'custom')),
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      deleted_at TEXT
    );

    CREATE TABLE list_items (
      id TEXT PRIMARY KEY,
      list_id TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
      text TEXT NOT NULL,
      checked INTEGER NOT NULL DEFAULT 0 CHECK (checked IN (0, 1)),
      checked_at TEXT,
      person_id TEXT REFERENCES people(id) ON DELETE SET NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE INDEX idx_list_items_list_sort ON list_items(list_id, sort_order);

    CREATE TABLE recipes (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      ingredients TEXT,
      instructions TEXT,
      image_path TEXT,
      tags TEXT,
      created_at TEXT NOT NULL,
      deleted_at TEXT
    );

    CREATE TABLE meal_slots (
      id TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      slot TEXT NOT NULL CHECK (slot IN ('breakfast', 'lunch', 'dinner', 'snack')),
      recipe_id TEXT REFERENCES recipes(id) ON DELETE SET NULL,
      free_text TEXT,
      UNIQUE (date, slot)
    );
    CREATE INDEX idx_meal_slots_date ON meal_slots(date);

    CREATE TABLE settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE devices (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      credential_hash BLOB NOT NULL,
      home_layout TEXT,
      theme_preference TEXT,
      sleep_settings TEXT,
      kiosk_preferences TEXT,
      registered_at TEXT NOT NULL,
      last_seen_at TEXT,
      revoked_at TEXT
    );

    CREATE TABLE auth_sessions (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL CHECK (kind IN ('parent', 'display')),
      device_id TEXT REFERENCES devices(id) ON DELETE CASCADE,
      secret_hash BLOB NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      revoked_at TEXT,
      CHECK ((kind = 'parent' AND device_id IS NULL) OR (kind = 'display' AND device_id IS NOT NULL))
    );
    CREATE INDEX idx_auth_sessions_expiry ON auth_sessions(expires_at);

    CREATE TABLE sync_status (
      service TEXT PRIMARY KEY,
      last_started_at TEXT,
      last_succeeded_at TEXT,
      last_error TEXT,
      updated_at TEXT NOT NULL
    );
  `,

  // 002 - normalized child names for safe audience inference
  `
    ALTER TABLE people ADD COLUMN normalized_name TEXT;
    CREATE UNIQUE INDEX idx_people_active_child_normalized_name
      ON people(normalized_name)
      WHERE role = 'child' AND deleted_at IS NULL;
  `,

  // 003 - single-household parent PIN and CSRF-bound parent sessions
  `
    CREATE TABLE household_auth (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      pin_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE auth_attempt_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      failed_attempts INTEGER NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
      backoff_until TEXT,
      updated_at TEXT NOT NULL
    );

    ALTER TABLE auth_sessions ADD COLUMN csrf_secret_hash BLOB;
  `,

  // 004 - retain parsed recurrence dates in the cached event store
  `
    ALTER TABLE events ADD COLUMN recurrence_exdates TEXT;
    ALTER TABLE events ADD COLUMN recurrence_rdates TEXT;
  `,

  // 005 - observable per-calendar synchronization health
  `
    ALTER TABLE calendars ADD COLUMN last_sync_attempt_at TEXT;
  `,

  // 006 - recurring weekly meal-plan defaults
  `
    CREATE TABLE meal_templates (
      day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 1 AND 7),
      slot TEXT NOT NULL CHECK (slot IN ('breakfast', 'lunch', 'dinner')),
      free_text TEXT NOT NULL,
      PRIMARY KEY (day_of_week, slot)
    );
  `,

  // 007 - person theme and celebration contract, before managed media upload
  `
    CREATE TABLE media_assets (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL CHECK (kind IN ('celebration', 'theme_background', 'photo')),
      original_name TEXT NOT NULL,
      media_type TEXT NOT NULL,
      byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
      width INTEGER NOT NULL CHECK (width > 0),
      height INTEGER NOT NULL CHECK (height > 0),
      frame_count INTEGER NOT NULL CHECK (frame_count > 0),
      sha256 TEXT NOT NULL UNIQUE,
      storage_key TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      deleted_at TEXT
    );
    CREATE INDEX idx_media_assets_active_kind ON media_assets(kind) WHERE deleted_at IS NULL;

    ALTER TABLE people ADD COLUMN theme_id TEXT;
    ALTER TABLE people ADD COLUMN celebration_asset_id TEXT REFERENCES media_assets(id) ON DELETE RESTRICT;
    ALTER TABLE people ADD COLUMN celebration_enabled INTEGER NOT NULL DEFAULT 1 CHECK (celebration_enabled IN (0, 1));
    ALTER TABLE people ADD COLUMN celebration_duration_ms INTEGER NOT NULL DEFAULT 3000
      CHECK (celebration_duration_ms BETWEEN 1500 AND 5000);
  `
  ,
  // 008 - more than one celebration per person; the legacy primary column is retained for compatibility.
  `
    ALTER TABLE people ADD COLUMN celebration_asset_ids TEXT NOT NULL DEFAULT '[]';
    UPDATE people SET celebration_asset_ids = CASE
      WHEN celebration_asset_id IS NULL THEN '[]'
      ELSE json_array(celebration_asset_id)
    END;
  `,

  // 009 - CalDAV and ICS source connection details
  `
    ALTER TABLE calendar_sources ADD COLUMN base_url TEXT;
    ALTER TABLE calendar_sources ADD COLUMN username TEXT;
    ALTER TABLE calendar_sources ADD COLUMN password_enc BLOB;
  `,

  // 010 - paired parent phones. Deliberately a separate table from devices:
  // a parent credential is far more powerful than a display one, and keeping
  // the two registries disjoint makes confusing them structurally impossible
  // rather than something a test has to keep catching.
  `
    CREATE TABLE parent_devices (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      credential_hash BLOB NOT NULL UNIQUE,
      paired_at TEXT NOT NULL,
      last_seen_at TEXT,
      revoked_at TEXT
    );
  `,

  // 011 - the phone's own clock for the last snapshot applied to a calendar.
  // A phone pushes full-window snapshots, so an out-of-order push would
  // otherwise resurrect events a newer one had already reconciled away.
  `
    ALTER TABLE calendars ADD COLUMN last_pushed_at TEXT;
  `,

  // 012 - screen-initiated enrolment (ADR 0006). An unregistered screen mints a
  // row here and shows its code as a QR on a wall, so the code is public by
  // construction. Two secrets guard the row and only their digests are stored:
  // the short human-readable code a parent redeems, and a high-entropy poll
  // token that never leaves the minting screen and is the only thing that can
  // collect the resulting display credential.
  `
    CREATE TABLE display_enrolment_codes (
      id TEXT PRIMARY KEY,
      code_hash BLOB NOT NULL UNIQUE,
      poll_token_hash BLOB NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      redeemed_at TEXT,
      display_id TEXT REFERENCES devices(id) ON DELETE CASCADE
    );
  `,

  // 013 - calendar write-back (ADR 0007). Three things, all serving one rule:
  // an event authored here lives on the board's own calendar, and travels
  // outward only when a tagged person has somewhere writable to put it.
  `
    -- The board's own calendar. Seeded, not connected: it has no address and no
    -- credential, the sync scheduler must skip it, and removing a source must
    -- never remove it. Its ids are fixed constants in src/shared/localCalendar.ts.
    INSERT INTO calendar_sources (id, kind, name, connected_at)
    VALUES ('osl-local-source', 'local', 'OpenSkyLight', '1970-01-01T00:00:00.000Z');

    INSERT INTO calendars (id, source_id, source_calendar_id, name, color, selected)
    VALUES ('osl-local-calendar', 'osl-local-source', 'openskylight', 'OpenSkyLight', '#0091FF', 1);

    -- Who authored an event. This is the whole basis of the re-tag rule: moving
    -- an event means deleting it from a calendar, and that is only ever safe on
    -- one we created. A re-tagged remote event changes board audience only.
    ALTER TABLE events ADD COLUMN origin TEXT NOT NULL DEFAULT 'remote'
      CHECK (origin IN ('local', 'remote'));

    -- Where a local event's outward copy ended up, as the same
    -- "<calendar_id>\\u0000<source_event_id>" key the feed already resolves
    -- exceptions by. The feed suppresses whichever row another row mirrors, so
    -- one event authored here shows once even after it syncs outward and is read
    -- straight back in.
    --
    -- UID deduplication cannot do this job alone: Android's calendar provider
    -- exposes no iCalendar UID at all, so a phone's copy of a board-authored
    -- event arrives with a null UID and nothing to match on.
    ALTER TABLE events ADD COLUMN mirror_key TEXT;

    -- The person tagged in one event. Audience was previously a property of a
    -- whole calendar, which cannot express "this event is Sam's" on a shared
    -- family calendar — and the board's own calendar is exactly that. An event
    -- tag overrides its calendar's mapping; both still fall back to the name
    -- inference in shared/audience.ts.
    --
    -- This is also the input to the routing rule: tagging a person who has a
    -- writable calendar is what sends an event outward.
    ALTER TABLE events ADD COLUMN audience_person_id TEXT REFERENCES people(id) ON DELETE SET NULL;
    CREATE INDEX idx_events_audience_person ON events(audience_person_id);

    -- Whether the source will accept a write. Previously computed live from
    -- CalDAV privileges and then discarded, which left the routing rule unable
    -- to answer "does this person have a *writable* calendar" without a network
    -- call. An ICS feed is always read-only; a CalDAV collection reports itself.
    ALTER TABLE calendars ADD COLUMN read_only INTEGER NOT NULL DEFAULT 0
      CHECK (read_only IN (0, 1));

    -- The board's own calendar is writable by definition; an ICS feed never is.
    UPDATE calendars SET read_only = 1
      WHERE source_id IN (SELECT id FROM calendar_sources WHERE kind = 'ics');

    -- The outbound queue. Every write goes through it, so an unreachable source
    -- behaves the same whether the edit came from the wall or from a phone.
    --
    -- UNIQUE (calendar_id, ical_uid) is what makes a queue rather than a log:
    -- four edits before the source returns coalesce into one write carrying the
    -- final state. 'sent' rows are kept, not deleted, because source_event_id
    -- recorded from an acknowledged create is what turns a crash replay into an
    -- update instead of a duplicate event.
    -- The event_id column is nullable and does NOT cascade, which is load-bearing: the
    -- commonest reason to queue a write is that the event was just deleted here,
    -- and a cascade would destroy the instruction to delete it there too. The
    -- row carries everything the write needs without the event: its calendar,
    -- its UID, the payload, and the etag to make the delete conditional.
    CREATE TABLE event_writes (
      id TEXT PRIMARY KEY,
      event_id TEXT REFERENCES events(id) ON DELETE SET NULL,
      calendar_id TEXT NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
      ical_uid TEXT NOT NULL,
      operation TEXT NOT NULL CHECK (operation IN ('create', 'update', 'delete')),
      payload TEXT NOT NULL,
      etag TEXT,
      source_event_id TEXT,
      state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'sent', 'failed')),
      attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_attempt_at TEXT,
      last_error TEXT,
      UNIQUE (calendar_id, ical_uid)
    );
    CREATE INDEX idx_event_writes_pending ON event_writes(calendar_id, created_at) WHERE state = 'pending';

    -- What last-writer-wins discarded. ADR 0007 permits the rule only because
    -- this table exists: the losing version is recoverable and visible to a
    -- parent rather than silently gone.
    CREATE TABLE event_conflicts (
      id TEXT PRIMARY KEY,
      event_id TEXT REFERENCES events(id) ON DELETE SET NULL,
      calendar_id TEXT NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
      discarded_side TEXT NOT NULL CHECK (discarded_side IN ('local', 'remote')),
      discarded_payload TEXT NOT NULL,
      detected_at TEXT NOT NULL,
      resolved_at TEXT
    );
    CREATE INDEX idx_event_conflicts_open ON event_conflicts(detected_at) WHERE resolved_at IS NULL;
  `,

  // 014 - the enrolment hand-off lives entirely in this row. A display's
  // credential is minted when its screen collects it, not when the phone
  // redeems, so nothing waits in server memory between the two and a restart
  // in that gap loses nothing. collected_at is what keeps the release single-use.
  `
    ALTER TABLE display_enrolment_codes ADD COLUMN collected_at TEXT;
  `
]

export const latestSchemaVersion = migrations.length

/** Applies all pending migrations in one transaction per version. */
export function runMigrations(sqlite: Database.Database): void {
  const currentVersion = sqlite.pragma('user_version', { simple: true }) as number
  if (!Number.isInteger(currentVersion) || currentVersion < 0 || currentVersion > migrations.length) {
    throw new Error(`Unsupported database schema version: ${currentVersion}`)
  }

  for (let version = currentVersion; version < migrations.length; version += 1) {
    sqlite.transaction(() => {
      sqlite.exec(migrations[version])
      sqlite.pragma(`user_version = ${version + 1}`)
    })()
  }
}
