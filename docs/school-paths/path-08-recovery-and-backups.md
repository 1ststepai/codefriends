# Path 08: Recovery & backups

**Goal:** You can restore durable data (or rebuild from a known backup) before a disk dies — and you have practiced once, not only theorized.

**Help packet:** [path-08-recovery-and-backups.md](../help-packets/path-08-recovery-and-backups.md)

## Why this path

Persistence without recovery is a single point of failure with extra steps. Cohort DMs and board posts deserve a restore story.

## Constraints

- Match the driver you actually run (SQLite file, D1 export, Turso, …).
- Backups are useless if they never restore — practice on a throwaway copy.
- Official shelf seeds are idempotent; cohort content is not replaceable from seed alone.
- Do not require paid backup SaaS for this path; filesystem copy or platform export is enough to start.

## Steps

1. **Locate data.** Know the file path or D1 database id that holds users / messages / library.
2. **Backup.** Copy or export while the app is idle or using the platform’s recommended snapshot.
3. **Restore drill.** Point a local/dev instance at the copy (or import into a scratch DB) and read a known row.
4. **Seed vs data.** Confirm `seedOfficialLibrary` / demo seeds do not wipe the restored cohort rows.
5. **Write it down.** One paragraph in your operator notes: where backups live, how often, how to restore.

## Success criteria

- [ ] You have a backup artifact less than a week old (or automated).
- [ ] You have restored once into a non-production target and seen real rows.
- [ ] You know what seed data will reappear vs what only exists in backups.
- [ ] Loss scenario (“laptop dies”) has a named next action.

## Send-back checklist (if a friend helps)

- Restore steps the operator followed (commands redacted of secrets).
- Confirmation that smoke still passes on the primary instance.
- No production backups committed into the git repo.
