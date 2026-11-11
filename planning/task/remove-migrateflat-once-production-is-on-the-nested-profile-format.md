# Remove migrateFlat once production is on the nested profile format

Moved here from CLAUDE.md on 2026-11-10.

`src/userProfiles.ts` still carries `migrateFlat()`, called from `loadStore()`,
which turns the old flat `user_profiles.json` into the nested format the
first time a server loads it. The migration has been running lazily on the
commons box since its first start after the deploy that brought it.

Found 2026-11-10: `~/.local/state/imitation/user_profiles.json` on commons is
nested (`counter`, `nextId`, `users` at the top). What is left is to delete
`migrateFlat` and its call, in one commit.
