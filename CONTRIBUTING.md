# Contributing

Thanks for helping. The project is small on purpose: **zero runtime and zero dev dependencies**, plain ES modules, nothing to install.

## Set up

```bash
git clone https://github.com/UzRustamBek/agent-office.git
cd agent-office
npm test          # needs Node 20+
npm run check
npm run demo      # http://127.0.0.1:4317
```

## Ground rules

1. **Keep it dependency-free.** If a feature seems to need a package, open an issue first.
2. **Pure logic goes in `web/js/core/`** (no DOM, no Node APIs). The server, the browser and the tests all share it.
3. **No `innerHTML`, inline scripts, inline styles or external requests** in `web/`. `npm run check` enforces this together with the Content-Security-Policy.
4. **Text from rosters, agent files or events is untrusted.** Insert it with `textContent` and validate it in `normalizeEvent` / `normalizeRoster`.
5. **Everything visible is generated in code.** Do not add image files or third-party art; drawing it from rectangles keeps the licensing clean and the looks customizable.
6. **Privacy first.** Do not widen what the hook forwards, and keep full paths and file contents out of the UI.
7. **Add a test** for behaviour you change in `core/`, `server/` or `hook/`.

## Making a change

* Branch from `main`, keep commits focused, and describe the *why* in the message.
* Run `npm test` and `npm run check`. CI runs them on Linux and Windows with Node 20, 22 and 24.
* For visual changes, include a screenshot (`?demo=1&seed=21` gives a reproducible scene).
* User-facing text must exist in all three languages (`web/js/ui/i18n.js`).

## Good first issues

* A new hairstyle or accessory (`web/js/office/character.js`)
* A new piece of furniture (`web/js/office/draw.js` + `layout.js`, see [docs/CUSTOMIZING.md](docs/CUSTOMIZING.md))
* Another UI language
* An adapter that turns another agent CLI's events into the [event protocol](docs/ARCHITECTURE.md#event-protocol)

## Reporting bugs

Run `node bin/agent-office.js doctor` and paste the output into the issue, together with your OS, Node version and browser.
