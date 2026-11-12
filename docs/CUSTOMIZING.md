# Customizing

## Your team

Edit the roster ([AGENTS-FORMAT.md](AGENTS-FORMAT.md)). Looks, colors, departments and the number of agents all change the office automatically; there is nothing else to configure.

## Settings in the app

Open the gear icon: language, theme, name tags (always / on hover / selected only), office lighting (follow local time / day / night), speech bubbles, reduced motion, sound alerts and (in demo mode) simulation speed. They are stored in the browser.

URL parameters override them, which is handy for sharing a link or taking screenshots:

| Parameter | Example | Effect |
|---|---|---|
| `demo` | `?demo=1` | force demo mode even when a server is running |
| `lang` | `?lang=uz` | `en`, `uz`, `ru` |
| `theme` | `?theme=light` | `auto`, `dark`, `light` |
| `lighting` | `?lighting=night` | `auto`, `day`, `night` |
| `names` | `?names=hover` | `always`, `hover`, `off` |
| `speed` | `?speed=2` | demo speed, 0.25 to 8 |
| `seed` | `?seed=21` | reproducible demo |
| `motion` | `?motion=reduced` | calmer animation |

## Translations

All UI text is in `web/js/ui/i18n.js`. Add a language by copying the `en` table, translating the values and registering it in `LANGS` and `TABLES`. Agent names, roles and activity texts come from your data and are never translated.

## Art

Everything is drawn from rectangles, so changes are plain code:

* **Palette and skin/hair colors:** `web/js/office/palette.js`
* **Characters** (hairstyles, accessories, poses): `web/js/office/character.js`. A new hairstyle is one more `case` in `drawHair` for front, side and back views
* **Furniture:** `web/js/office/draw.js`. Add a function that draws into a tile rectangle, register it in `furnitureLayers` with a depth (`z` = the y of its base in pixels), then place it in `web/js/core/layout.js` with `addFurniture(type, x, y, w, h)`. Footprints are blocked for walking automatically
* **Lounge pieces:** `buildLounge`, `buildPantry`, `buildMeeting` in `layout.js`. Walkable places for idle agents are declared with `addSpot(kind, x, y, face, { sink, standing })`

Run `npm test` after changing the layout: the tests verify that nothing overlaps and that every seat can be reached.

## Behaviour

* How long agents rest, how long a break lasts and how fast they walk: the constants at the top of `web/js/office/world.js`
* Status timeouts (`done`, `error`, stale): `DEFAULT_TIMING` in `web/js/core/model.js`
* How hook events map to statuses: `server/events.js`
* What the demo does: `web/js/sim/demo.js`

## Embedding

`web/` is a static site. Serve it from any web server; without `/api/state` it runs the demo, and with a reverse proxy to a running Agent Office server it shows live data. For your own hosting, copy `agents.example.json` (or your roster) next to `index.html`.
