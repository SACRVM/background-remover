# background-remover

AI background removal as an app built on
[SACRVM APPKIT](https://github.com/SACRVM/sacrvm-appkit). It started as the
Background Remover tool of DREAM TOOLS and was taken out as an app of its
own. The old "TO VECTORIZER" hand-off became plain file flow: save or copy
the cut-out, open or paste it in the Vectorizer app — on a desktop both see
the same shared file space.

## The shape (same as every kit app)

**One repo, one app.** `app.json` (the manifest a desktop reads), `app.js`
(one custom element, classic script, guarded define), `app.css`, `index.html`
as the standalone harness, and `kit/` — the vendored kit.

- **No build step, ever.** Vanilla custom elements, plain CSS, a static
  server and F5.
- **The kit is vendored** (autark): `kit/` is the release ZIP's copy,
  verbatim — `kit/VERSION` says which — and never edited here. To upgrade,
  delete `kit/` and unzip the next release (see the appkit's `CONSUMING.md`).
  Use only the kit's documented API and its tokens — no raw colours.
- **transformers.js is the one CDN import** (pinned `@4.2.0`, jsDelivr,
  dynamic `import()` from the classic app script): it fetches its ONNX runtime
  and the models from the network anyway, so vendoring it would buy nothing.
- **Both models are pinned to WASM.** WebGPU produced striped or empty masks
  on some GPUs for both RMBG-1.4 and MODNet — do not "optimise" that back.
- **Files go through the kit:** `context.files.open/save`, never a hand-made
  `<input type=file>` or download link.
- **Keys and paste are live only while the app is on screen** (an
  IntersectionObserver), so a hidden view on a desktop never answers another
  app's Ctrl+Z / Ctrl+V.
- **Model licence:** RMBG-1.4 is non-commercial (BRIA licence) — the
  `notices` in `app.json` say so. Keep that notice if the model changes.
- If the kit is missing something, route it to the appkit via Firepit instead
  of working around it here.

## UI conventions

Shared by the four apps that came out of DREAM TOOLS (vectorizer,
background-remover, mesh-optimizer, svg-to-3d) — keep them identical.

1. **Toolbar order:** Open (`btn`, icon `folder`, not primary) · main export
   (`btn primary`, icon `download`, label = format, pinned with
   `data-overflow="never"` — the ribbon's overflow folds from the end, so an
   unpinned primary would vanish into "…" on a phone while Open stays) · further
   formats in one `sac-menu` "More ▾" · Copy where it applies
   (`nav-icon-btn`) · app-specific icon buttons · Credits (`copyright`) · Help
   (`info`).
2. **Exports always ask** (Save as…) — no silent overwrite through a kept
   handle. Ctrl+S on an empty app does nothing.
3. **Credits via `sac.about`** from the manifest — the `notices` in `app.json`
   are what users see, keep them complete.
4. **Empty state = `sac-drop-zone`** in `.app-drop`, styled by the shared
   `.app-drop` CSS block (identical in all four `app.css`; the zone carries
   the kit's `on-viewport` class, because the viewport is black in both
   themes, plus one opaque `--glass` line — the kit's glass is translucent
   and the scene showed through; clears the label row and the HUD). Its
   click / Enter go through `context.files.open`, not the device picker.
   The zone is `quiet` (kit ≥ 2.36): files it did not take get one toast
   from the `_wireDropZone` snippet, built from `sac:rejected`'s
   `detail.rejected` — the zone hides once a file opens, so its own line
   would go unseen after a partial drop.
5. **Settings are remembered:** controls with `data-keep="key"` are saved to
   `context.fs` ("settings") and replayed on mount through their kit event.
   Per-document values (e.g. a threshold fitted to one image) are not kept.
6. **Ctrl+O / Ctrl+S** (open / main export) through `sac.hotkeys`, registered
   only while the app is on screen.
7. **No prose on the UI.** Panels, windows and the empty state carry controls,
   short labels and data readouts only — every explanation goes into the Help
   window.

8. **View reset:** every app with a zoomable / orbitable view has a
   `nav-icon-btn` with icon `fit` in its app-specific icon group.
9. **Unsaved work is guarded** where the user edits something (not for pure
   parameter apps): `context.setDirty` on the first edit, cleared after a
   successful save; replacing a dirty document asks `sac.dialog.confirm`
   ("Discard unsaved changes?"). Never the native `confirm()`.
10. **Keyboard through `sac.hotkeys` only** — no raw keydown listeners for
    shortcuts; apps with more than Open/Save get a `keyboard` button and the
    `?` key opening a `sac-shortcut-sheet`. Hold-keys (Space to pan) go
    through `sac.hotkeys.hold` (kit ≥ 2.12).
11. **Feedback is visible:** results and warnings go to `sac.toast`, work that
    blocks for more than a moment shows a busy overlay — never console only.
12. **Kit controls with their limits:** `sac-stepper` for numbers, decimals
    included (kit ≥ 2.12.1 sizes its field to the widest value of min/max) —
    keep `min`/`max` tight so the pill fits a half-width panel column; it
    snaps every value to its `step` grid.
    Slider readouts carry a unit or named steps, never a bare technical number.
13. **Theme toggle** (`sac-theme-toggle` in the nav's `context` slot) only
    standalone — removed when `context.host` is set.
14. **Settings migrations** go through the snippet's `_migrateSettings(saved)`
    hook (sync, returns the migrated object) — the `_restoreSettings` snippet
    stays byte-identical in all four apps.

**Language:** chat in German, code/docs/commits in English.

## Develop, test, publish

Shared by the four apps that came out of DREAM TOOLS — keep identical.

- **Dev loop:** `python3 -m http.server 3342` (Firepit command "Run site"),
  F5. `npx serve . -l 3342` works too and reads `serve.json`, which disables
  caching.
- **Test both runtimes — they fail differently.** Standalone (`index.html`,
  vendored kit) AND installed on https://desktop.sacrvm.dev/ (the host's kit
  is live there; the app is injected into the host page). Recipe and a
  template script: global knowledge doc "Headless-testing SACRVM appkit apps"
  (`firepit_knowledge_search`). Stub `context.files.save/open` in tests —
  real pickers hang headless.
- **Always check:** dark + light theme + a 390px phone viewport (look at the
  screenshots), console clean, settings survive a reload, every export
  arrives, Ctrl+O / Ctrl+S.
- **Publish:** bump `version` in `app.json` (semver: fix = patch, feature =
  minor), commit, push to `main`. GitHub Pages serves `main` / root; wait
  until `https://sacrvm.github.io/<repo>/app.json` shows the new version,
  then re-test installed on the desktop. The repo carries the topic
  `sacrvm-app` → listed in the desktop's App Store. Desktops store the
  address, not a copy: every push is live for every installation.
- **Kit upgrade:** delete `kit/`, unzip the new release's `kit/` verbatim
  (`gh release download vX.Y.Z -R SACRVM/sacrvm-appkit`), check
  `CONSUMING.md` / `MIGRATION.md` for breakers, test both runtimes, commit
  "Vendor SACRVM APPKIT X.Y.Z". Never edit `kit/`.
- **Siblings:** vectorizer, background-remover, mesh-optimizer, svg-to-3d
  share the UI conventions and the `_restoreSettings` / `_about` /
  `_wireDropZone` / `_registerFileKeys` snippet byte-for-byte. A change to
  either belongs in all four — say so in the commit.

## Open items

Kit 2.37.0 is vendored (2026-11-09; 2.36.0 earlier that day, 2.12.0 before).
Taken up from the releases since 2.12: the quiet drop zone with one toast
per `sac:rejected` (2.36), a solid busy overlay under reduced transparency /
more contrast (2.33). Checked and n/a here: `sac-log`, `sac-loader` (the
busy overlay is the app's own and covers only the stage), `sac-dialog` and
its edit guard (2.36.1; only `sac.dialog.confirm`), explicit toast
durations, long-press and `[data-no-long-press]` (2.36.2; a held finger on
the original fires `contextmenu`, which the app blocks itself in magic-wand
mode, mouse and touch alike; the wand acts on the tap itself),
`--split-back-height` (2.37; nothing sticky under the split's back bar).

Version skew: hosted on the desktop the app runs on the host's kit
(desktop.sacrvm.dev serves 2.37.0 since 2026-11-09). The drop-zone snippet
falls back to the bare `files` list of an older kit.

Owner decisions open:
- **Accent colour:** own pink vs following the desktop colour by default.
- App → app hand-off deferred (see vectorizer's note; the shared file space
  bridges it).
- RMBG-1.4 is non-commercial — keep the notice if the model changes.

## Firepit inbox

At the start of a session, read any pending messages in `.firepit/inbox/*.md` — cross-project notes Firepit routes here. Act on each, then mark it done with the `firepit_inbox_complete` MCP tool, passing the message's filename as the `id`.

## Firepit knowledge

Before researching something that may already be known, query the knowledge base with the `firepit_knowledge_search` MCP tool (scope `both` covers this project plus the global base). Save durable findings with `firepit_knowledge_add` — written in English, per the indexing convention. The created markdown files live under `.firepit/knowledge/` and are committed like any other file.

## Firepit pinned knowledge

@.firepit/knowledge-pinned.md

The import above auto-loads the knowledge docs marked `pin: true` in their frontmatter — always-on rules that apply every session without a search. Firepit regenerates the file from the pinned docs; don't edit it directly. Pin/unpin via the pinned flag on `firepit_knowledge_add` / `firepit_knowledge_update`, and keep the pinned set small — everything else stays reachable through `firepit_knowledge_search`.

## Firepit conventions

<!-- claude-firepit-fragments -->

@../.firepit/projects/claude.md
@../.firepit/projects/claude-github-public.md

The two imports above are shared files in the Firepit central repo — edit them there and every project follows. They carry policy; the tools themselves are described by Firepit's MCP server at the handshake, so nothing is duplicated between the two.
