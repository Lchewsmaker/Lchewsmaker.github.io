# Void Tabletop

A browser tabletop for Magic: The Gathering. You can build decks with every printing on Scryfall, open a room, share the code with friends, and play on a live table. It's a static site with no build step and no server of its own, so it runs on GitHub Pages or straight from disk.

## Features

- **Lobby.** Host a room and share the 6-letter code or an invite link (`?join=CODE`), or join someone else's. Players mark themselves ready, and the host can reorder or kick players. There's also a solo / goldfish mode.
- **Formats.** 1v1 Constructed (best-of-three tracking and sideboarding), Commander (2–6 players), Commander Duel, Free-for-all, Two-Headed Giant (shared team life), and Brawl. Advanced options cover starting life and hand size, the mulligan rule (London, Vancouver, Paris), who goes first, lethal commander damage and poison, a free first mulligan, randomized seating, a chess clock, and deck legality checks.
- **Deck builder.** Search Scryfall with full syntax, autocomplete, and filters. Drag cards into the main deck, sideboard, maybeboard, or commander slot. Change any card's printing by clicking its set code. You also get stats (mana curve, colour pips, types, price), legality checking, import and export (Arena, MTGO, Moxfield, plain text), sample hands, and playtesting.
- **Table.**
  - Drag and drop between hand, battlefield, library, graveyard, exile, and the command zone.
  - Box-select or Ctrl-click to move groups of cards.
  - Right-click menus that change depending on where you click.
  - Counters, tokens (searched on Scryfall), transform / flip / face-down, commander tax and commander damage, monarch and initiative, day/night, dice, undo, and a log with chat.
- **Arrows.** Hold **W** and release over a target, or tap W and then click. Arrows are drawn in red and every player sees them.
- **Board views.** Focus, Grid, or Spotlight, plus optional face-to-face (mirrored) opponents. Every player's battlefield uses the same layout.
- **Accessibility.**
  - Interface scaling, high contrast, a hyper-legible font, larger text, and reduced motion.
  - Colour-blind-safe player colours with patterns, and an arrow colour you can change.
  - Screen-reader announcements, keyboard focus for cards, and long-press menus on touch screens.
- Press **?** in the app for every keyboard shortcut.

## Running locally

Open `index.html` in a browser, or serve the folder:

```sh
python3 -m http.server 8000
```

## How multiplayer works

Players connect directly to each other over WebRTC using [PeerJS](https://peerjs.com/). The public PeerJS server is only used to introduce players to each other. The host relays game messages. Hidden information never leaves your browser: your library order and the contents of your hand stay local unless you reveal them.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Page shell |
| `css/app.css` | All styles |
| `js/util.js` | DOM helpers, storage, modals, context menus, sound |
| `js/scryfall.js` | Scryfall API client (rate-limited and cached) |
| `js/settings.js` | Settings, accessibility, shortcuts |
| `js/decks.js` | Deck storage, formats, legality, import/export |
| `js/builder.js` | Deck builder UI and printings picker |
| `js/net.js` | PeerJS networking |
| `js/lobby.js` | Profile, game modes, rooms |
| `js/game.js` | Game state and rules helpers |
| `js/board.js` | Table rendering, drag and drop, menus, arrows |
| `js/app.js` | Startup and navigation |

---

Card data and images © Scryfall / Wizards of the Coast. Void Tabletop is unofficial Fan Content permitted under the Fan Content Policy. It is not approved or endorsed by Wizards. Portions of the materials used are property of Wizards of the Coast. © Wizards of the Coast LLC.
