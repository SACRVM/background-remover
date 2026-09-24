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

- **No build step, ever.** Vanilla custom elements, plain CSS, `npx serve .`
  and F5.
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

**Language:** chat in German, code/docs/commits in English.

## Firepit inbox

At the start of a session, read any pending messages in `.firepit/inbox/*.md` — cross-project notes Firepit routes here. Act on each, then mark it done with the `firepit_inbox_complete` MCP tool, passing the message's filename as the `id`.

## Firepit knowledge

Before researching something that may already be known, query the knowledge base with the `firepit_knowledge_search` MCP tool (scope `both` covers this project plus the global base). Save durable findings with `firepit_knowledge_add` — written in English, per the indexing convention. The created markdown files live under `.firepit/knowledge/` and are committed like any other file.

## Firepit pinned knowledge

@.firepit/knowledge-pinned.md

The import above auto-loads the knowledge docs marked `pin: true` in their frontmatter — always-on rules that apply every session without a search. Firepit regenerates the file from the pinned docs; don't edit it directly. Pin/unpin via the pinned flag on `firepit_knowledge_add` / `firepit_knowledge_update`, and keep the pinned set small — everything else stays reachable through `firepit_knowledge_search`.

## Firepit artifacts

When you produce a file the user will want to open — a report, screenshot, diagram, generated image, log excerpt, build output, or an executable you built for them to run — pin it with the `firepit_artifact_add` MCP tool so it appears in the project's paperclip pane. Do this as you produce it, not at the end of the session; a path buried in scrollback is a path the user has to hunt for. Pinning only links the file — it stays where it is, and `firepit_artifact_remove` never deletes it. Check `firepit_artifact_list` first so you update an existing entry instead of piling up near-duplicates, and unpin what has gone stale.

## Firepit conventions

<!-- claude-firepit-fragments -->

@../.firepit/projects/claude.md
@../.firepit/projects/claude-github-public.md

The two imports above are shared files in the Firepit central repo — edit them there and every project follows. They carry policy; the tools themselves are described by Firepit's MCP server at the handshake, so nothing is duplicated between the two.
