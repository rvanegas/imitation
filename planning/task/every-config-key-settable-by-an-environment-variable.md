# Every config key settable by an environment variable

Noted 2026-11-10. technosophia's `SERVICES.md` has config in
`~/.config/<project>/config.toml` *with an environment variable for each
key*. `src/config.ts` reads only the TOML file. Add a variable per key
(`IMITATION_BOT_TOKEN`, `IMITATION_ANTHROPIC_API_KEY`, and so on), the
environment winning over the file, and name them in `config.toml.example`.
