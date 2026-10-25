# TODO

## The app's server address comes from the Mac's config file

Noted 2026-10-24, during the move to the commons box
(`~/src/rvanegas-site/SITE.md`, Phase 2). Left as it is for now and assumed
to work.

`[websocket] url` in `~/.config/imitation/config.toml` has two readers:

- **The server** (`src/config.ts`) takes only its port for `WS_PORT`; the
  host part is ignored.
- **The app's build** (`app/app.config.js`) reads the whole URL from the
  config file of whichever machine runs the Expo build, and bakes it in as
  `extra.serverUrl`, which `app/src/ws.ts` connects to. On the Mac it is
  `ws://176.108.141.8:8080`.

Things to attend to:

- **`app/app.json` is probably ignored.** `app/app.config.js` exports a plain
  object, and Expo then uses it and not `app.json`. So the
  `extra.serverUrl = "wss://imitation.rvanegas.co/ws"` added to `app.json` on
  the `commons` branch likely has no effect. Check with `npx expo config`, then
  keep one of the two files.
- **`scheme: "imitation"` is only in `app.json`.** If `app.json` is ignored,
  builds do not register `imitation://`, and the invite links
  (`imitation://join/<token>`, `src/websocket.ts`) would not open the app.
- **Pointing the app at the box** needs the build's server URL to be
  `wss://imitation.rvanegas.co/ws`, either in `app.config.js` or, as things
  stand, as `url` in the building machine's config. That URL has no port, so
  the server falls back to 8080 and still runs on the Mac.
- The setting's name hides that it does two jobs. A plain `port` for the
  server and an explicit app setting would say what each one is for.
