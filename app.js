/**
 * <app-background-remover> — AI background removal as a SACRVM APPKIT app
 * (kind: "view").
 *
 * Removes the background from any photo fully in the browser via
 * transformers.js (ONNX). No upload, no server, no cost: the model downloads
 * once and the browser caches it.
 *
 * Two models, picked by subject:
 *   General  → briaai/RMBG-1.4 — objects and products, crisp edges (~44 MB)
 *   Hair     → Xenova/modnet   — people, soft hair and fine edges (~26 MB)
 *
 * What goes where:
 *   nav + toolbar  — the app's own <sac-nav>: Open, Save PNG, Copy,
 *                    Undo / Redo, Help.
 *   control panel  — a .sidebar in the start slot of a <sac-split>; on a
 *                    phone the nav adopts it as its drawer.
 *   stage          — original | cut-out under ONE pan-zoom transform,
 *                    stacked when narrow. The magic wand works on the
 *                    original.
 *
 * transformers.js is the one thing NOT vendored: it pulls its ONNX runtime
 * and the models from the network anyway, so it is imported, pinned, from
 * jsDelivr on first use.
 */
(function () {
    const BASE = sac.app.base();
    const CSS_ID = "app-background-remover-css";
    const TRANSFORMERS = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.2.0/dist/transformers.min.js";

    const ACCEPT = "image/png,image/jpeg,image/webp,image/bmp";
    const HISTORY_MAX = 20;

    /* ------------------------------------------------------------ engine -- */

    let tfPromise = null;
    function loadTransformers() {
        if (!tfPromise) {
            // A classic script reaches an ES module through dynamic import.
            tfPromise = import(TRANSFORMERS).then((tf) => {
                tf.env.allowLocalModels = false;
                return tf;
            }).catch((err) => { tfPromise = null; throw err; });
        }
        return tfPromise;
    }

    const MODELS = {
        general: {
            id: "briaai/RMBG-1.4",
            label: "RMBG-1.4",
            hint: "General objects & products. Crisp, but harder edges (less hair detail). ~44 MB.",
            // Pinned to WASM: some GPUs band RMBG on WebGPU (fp32 included).
            // The CPU path is a touch slower but never striped or empty.
            device: "wasm",
            load: (tf, device, pc) => tf.AutoModel.from_pretrained("briaai/RMBG-1.4", {
                config: { model_type: "custom" }, device, dtype: "fp32", progress_callback: pc,
            }),
            processor: (tf, pc) => tf.AutoProcessor.from_pretrained("briaai/RMBG-1.4", {
                config: {
                    do_normalize: true, do_pad: false, do_rescale: true, do_resize: true,
                    image_mean: [0.5, 0.5, 0.5], image_std: [1, 1, 1], resample: 2,
                    size: { width: 1024, height: 1024 },
                },
                progress_callback: pc,
            }),
        },
        portrait: {
            id: "Xenova/modnet",
            label: "MODNet",
            hint: "Tuned for people & portraits — soft hair and fine edges. ~26 MB.",
            // Pinned to WASM: MODNet on WebGPU produced striped (fp16) or
            // empty (fp32) masks on some GPUs. WASM fp32 is deterministic.
            device: "wasm",
            load: (tf, device, pc) => tf.AutoModel.from_pretrained("Xenova/modnet", { device, dtype: "fp32", progress_callback: pc }),
            processor: (tf, pc) => tf.AutoProcessor.from_pretrained("Xenova/modnet", { progress_callback: pc }),
        },
    };

    /* ------------------------------------------------------- pure raster -- */

    /** Gaussian-ish blur of a single-channel alpha buffer via the canvas filter. */
    function blurAlpha(a, w, h, radius) {
        const c = document.createElement("canvas"); c.width = w; c.height = h;
        const cx = c.getContext("2d");
        const id = cx.createImageData(w, h);
        for (let i = 0; i < a.length; i++) {
            id.data[4 * i] = id.data[4 * i + 1] = id.data[4 * i + 2] = a[i];
            id.data[4 * i + 3] = 255;
        }
        cx.putImageData(id, 0, 0);
        const c2 = document.createElement("canvas"); c2.width = w; c2.height = h;
        const cx2 = c2.getContext("2d");
        cx2.filter = `blur(${radius}px)`;
        cx2.drawImage(c, 0, 0);
        const blurred = cx2.getImageData(0, 0, w, h).data;
        const res = new Uint8ClampedArray(w * h);
        for (let i = 0; i < res.length; i++) res[i] = blurred[4 * i];
        return res;
    }

    /* --------------------------------------------------------------- app -- */

    class AppBackgroundRemover extends sac.app.Element {
        build() {
            sac.app.styles(BASE + "app.css", CSS_ID);
            this.innerHTML = `
<sac-nav brand="BACKGROUND REMOVER" brand-icon="scissors" brand-href="#/" host-nav="wide">
    <div slot="context" class="br-theme"><sac-theme-toggle></sac-theme-toggle></div>
    <div slot="toolbar" class="toolbar">
        <button type="button" class="btn br-open" title="Open an image (Ctrl+O)">
            <sac-icon name="folder"></sac-icon> Open
        </button>
        <button type="button" class="btn primary br-save" data-overflow="never" title="Save the cut-out as PNG (Ctrl+S)" disabled>
            <sac-icon name="download"></sac-icon> PNG
        </button>
        <button type="button" class="nav-icon-btn br-copy" title="Copy the cut-out" disabled>
            <sac-icon name="copy"></sac-icon>
        </button>
        <button type="button" class="nav-icon-btn br-undo" title="Undo (Ctrl+Z)" disabled>
            <sac-icon name="undo"></sac-icon>
        </button>
        <button type="button" class="nav-icon-btn br-redo" title="Redo (Ctrl+Y)" disabled>
            <sac-icon name="redo"></sac-icon>
        </button>
        <button type="button" class="nav-icon-btn br-fit" title="Reset view">
            <sac-icon name="fit"></sac-icon>
        </button>
        <button type="button" class="nav-icon-btn br-keys" title="Keyboard shortcuts (?)">
            <sac-icon name="keyboard"></sac-icon>
        </button>
        <button type="button" class="nav-icon-btn br-credits" title="Credits &amp; licences">
            <sac-icon name="copyright"></sac-icon>
        </button>
        <button type="button" class="nav-icon-btn br-help-btn" title="Help">
            <sac-icon name="info"></sac-icon>
        </button>
    </div>
</sac-nav>

<div class="main-layout br-root">
    <sac-split class="br-split" position="22%" min-start="240px" min-end="320px"
               aria-label="Resize the control panel">

        <div class="sidebar fill br-panel" slot="start">
            <sac-section title="Output">
                <div>
                    <label>Background</label>
                    <sac-segmented-control class="br-bgmode" data-keep="bgmode" value="transparent">
                        <button data-value="transparent">Transparent</button>
                        <button data-value="color">Solid color</button>
                    </sac-segmented-control>
                </div>
                <sac-color-field class="br-bgcolor" data-keep="bgcolor" label="Fill color" value="#1e293b" disabled></sac-color-field>
                <sac-toggle class="br-crop" data-keep="crop" label="Auto-crop to subject"></sac-toggle>
            </sac-section>

            <sac-section title="Edge">
                <sac-slider class="br-cut" data-keep="cut" label="Mask cutoff (0 = soft)" min="0" max="100" step="1" value="0" suffix="%"></sac-slider>
                <sac-slider class="br-feather" data-keep="feather" label="Feather" min="0" max="6" step="0.5" value="0" suffix="px"></sac-slider>
            </sac-section>

            <sac-section title="Cleanup (magic wand)">
                <div>
                    <label>Mouse tool</label>
                    <sac-segmented-control class="br-tool" value="pan">
                        <button data-value="pan">Pan / zoom</button>
                        <button data-value="wand">Magic wand</button>
                    </sac-segmented-control>
                </div>
                <div class="br-wand" hidden>
                    <div>
                        <label>Click action</label>
                        <sac-segmented-control class="br-wandmode" data-keep="wandmode" value="remove">
                            <button data-value="remove">Remove</button>
                            <button data-value="restore">Restore</button>
                        </sac-segmented-control>
                    </div>
                    <sac-slider class="br-tol" data-keep="tol" label="Tolerance" min="1" max="100" step="1" value="12" suffix="%"></sac-slider>
                    <sac-slider class="br-wandfeather" data-keep="wandfeather" label="Soften edge" min="0" max="4" step="0.5" value="1" suffix="px"></sac-slider>
                    <button type="button" class="btn br-reset">Reset mask</button>
                </div>
            </sac-section>

            <sac-section title="Model">
                <sac-segmented-control class="br-model" data-keep="model" value="general">
                    <button data-value="general">General (RMBG)</button>
                    <button data-value="portrait">Hair (MODNet)</button>
                </sac-segmented-control>
                <p class="br-device"></p>
            </sac-section>
        </div>

        <div class="br-stage" slot="end" data-bg="checker">
            <div class="viewport br-pane br-pane-src">
                <span class="br-pane-label">Original</span>
                <div class="pz-layer"><canvas class="br-src"></canvas></div>
            </div>
            <div class="viewport br-pane br-pane-out">
                <span class="br-pane-label">Cut-out</span>
                <div class="pz-layer"><canvas class="br-out"></canvas></div>
            </div>
            <div class="app-drop br-empty">
                <sac-drop-zone accept="image/png,image/jpeg,image/webp,image/bmp" label="Drop an image"
                               hint="or click to open" touch-label="Open an image" touch-hint=""></sac-drop-zone>
            </div>
            <div class="br-busy" hidden>
                <sac-spinner label="Working" style="--spinner-size: 28px"></sac-spinner>
                <span class="br-busy-label">Working…</span>
                <sac-progress class="br-bar" value="0" max="100"></sac-progress>
            </div>
        </div>

    </sac-split>
</div>

<sac-window class="br-help-win" title="Background Remover Guide" width="500px" height="480px"
            left="calc(50vw - 250px)" top="12vh" controls="close">
    <div class="br-help">
        <p>Removes the background from any photo using AI, running <b>100% in your browser</b>:
           no upload, no account, no cost. The model downloads once and the browser caches it,
           so later runs start at once and work offline.</p>
        <h3>Model</h3>
        <ul>
            <li><b>General (RMBG-1.4)</b>, the default: objects, products and most photos. Crisp, but harder
                edges with less hair detail. About 44&nbsp;MB.</li>
            <li><b>Hair (MODNet)</b>: people and portraits, soft hair and fine edges. About 26&nbsp;MB.</li>
        </ul>
        <p>Switching the model re-runs the current image. The line under the switch shows which model ran
           and on what (WASM = the CPU path).</p>
        <h3>Output and edge</h3>
        <ul>
            <li><b>Background:</b> transparent, or a solid fill colour.</li>
            <li><b>Auto-crop</b> trims the canvas to the subject.</li>
            <li><b>Mask cutoff</b> hardens edges (leave it at 0 for soft hair); <b>Feather</b> softens them.</li>
        </ul>
        <h3>Cleanup: magic wand</h3>
        <p>Fixes what the model got wrong. Switch the mouse tool to <b>Magic wand</b>, then click a region on the
           <b>original</b> (left): it flood-fills a similar-coloured area and <b>removes</b> it (leftover
           background) or <b>restores</b> it (wrongly cut parts). Left-click is the chosen action,
           <b>right-click the opposite</b>. <b>Tolerance</b> sets how far it spreads, <b>Soften edge</b>
           feathers the new edge. <b>Undo / Redo</b> (Ctrl+Z / Ctrl+Y) step through edits;
           <b>Reset mask</b> goes back to the model's output.</p>
        <h3>Files</h3>
        <p><b>Open</b> (Ctrl+O), drop or paste (Ctrl+V) an image. <b>PNG</b> (Ctrl+S) saves the cut-out and
           always asks where; the copy button puts it on the clipboard.</p>
        <h3>View</h3>
        <p>Wheel to zoom, drag to pan, double-click or the reset-view button to reset — both panes
           move together. In magic-wand mode, pan with the middle mouse button or by holding Space.</p>
        <p>All shortcuts: the keyboard button or <b>?</b>.</p>
        <p>Hand edits to the mask count as unsaved work: opening another image or switching the
           model asks before they are thrown away.</p>
        <p>Licences and credits: the © button.</p>
    </div>
</sac-window>
`;
        }

        onMount(context) {
            this._ctx = context;
            const $ = (s) => this.querySelector(s);
            const nav = $("sac-nav");
            if (nav) nav.host = context.host;
            if (context.host) $(".br-theme")?.remove();   // hosted: the desktop has its own theme toggle

            this._stage = $(".br-stage");
            this._paneSrc = $(".br-pane-src");
            this._srcCanvas = $(".br-src");
            this._outCanvas = $(".br-out");
            this._busy = $(".br-busy");
            this._busyLabel = $(".br-busy-label");
            this._bar = $(".br-bar");
            this._device = $(".br-device");
            this._saveBtn = $(".br-save");
            this._copyBtn = $(".br-copy");
            this._undoBtn = $(".br-undo");
            this._redoBtn = $(".br-redo");
            this.ui = {
                bgMode: $(".br-bgmode"),
                bgColor: $(".br-bgcolor"),
                crop: $(".br-crop"),
                cut: $(".br-cut"),
                feather: $(".br-feather"),
                tool: $(".br-tool"),
                wand: $(".br-wand"),
                wandMode: $(".br-wandmode"),
                tol: $(".br-tol"),
                wandFeather: $(".br-wandfeather"),
                model: $(".br-model"),
            };

            this._loaded = {};          // model key → { model, processor, device }
            this._loading = {};         // model key → Promise
            this._image = null;         // RawImage of the source
            this._rgba = null;          // source pixels, w*h*4
            this._mask = null;          // live alpha, w*h — the wand edits this
            this._baseMask = null;      // the model's pristine output, for Reset
            this._dims = { w: 0, h: 0 };
            this._undo = [];
            this._redo = [];
            this._name = "cutout";
            this._spaceHeld = false;
            this._runId = 0;            // a newer run makes an older one's result stale
            this._dirty = false;        // the mask has hand edits the last save does not hold
            this._modelKey = this.ui.model.value;   // the model the current mask came from

            this._pz = sac.setupPanZoom({
                panes: [
                    { pane: this._paneSrc, layer: $(".br-pane-src .pz-layer") },
                    { pane: $(".br-pane-out"), layer: $(".br-pane-out .pz-layer") },
                ],
                enabled: () => this._stage.classList.contains("has-image"),
            });

            this._wireToolbar();
            this._wireControls();
            this._wireDrop();
            this._wireWand();
            this._wireDropZone((file) => this._loadFile(file));

            // Keys and paste only while on screen — a hidden view on a desktop
            // must not answer somebody else's Ctrl+Z or Ctrl+V.
            this._onPaste = (e) => this._paste(e);
            this._onKeyDown = (e) => this._keyDown(e);
            this._onKeyUp = (e) => this._keyUp(e);
            this._io = new IntersectionObserver((entries) => {
                this._setVisible(entries[entries.length - 1].isIntersecting);
            });
            this._io.observe(this);

            this._restoreSettings();
        }

        onUnmount() {
            this._setVisible(false);
            this._io?.disconnect();
            this._io = null;
            clearTimeout(this._renderTimer);
        }

        _setVisible(on) {
            if (on === !!this._visible) return;
            this._visible = on;
            if (on) {
                document.addEventListener("paste", this._onPaste);
                window.addEventListener("keydown", this._onKeyDown);
                window.addEventListener("keyup", this._onKeyUp);
                const opts = { group: "Edit", skipInInput: true };
                const offs = [
                    sac.hotkeys.register("mod+z", () => this._undoStep(), { ...opts, description: "Undo" }),
                    sac.hotkeys.register("mod+y", () => this._redoStep(), { ...opts, description: "Redo" }),
                    sac.hotkeys.register("mod+shift+z", () => this._redoStep(), { ...opts, description: "Redo" }),
                ];
                const offFile = this._registerFileKeys(() => this._save());
                if (sac.shortcuts) {
                    offs.push(sac.shortcuts.bind());
                    offs.push(sac.shortcuts.add([
                        { group: "View", keys: ["Wheel"], description: "Zoom" },
                        { group: "View", keys: ["Drag"], description: "Pan" },
                        { group: "View", keys: "Space + drag", description: "Pan in magic-wand mode" },
                        { group: "View", keys: ["Double-click"], description: "Reset view" },
                        { group: "Magic wand", keys: ["Click"], description: "Chosen action" },
                        { group: "Magic wand", keys: ["Right-click"], description: "Opposite action" },
                    ]));
                }
                this._offHotkeys = () => { offs.forEach((off) => off()); offFile(); };
            } else {
                document.removeEventListener("paste", this._onPaste);
                window.removeEventListener("keydown", this._onKeyDown);
                window.removeEventListener("keyup", this._onKeyUp);
                this._offHotkeys?.();
                this._offHotkeys = null;
                this._keyUp({ code: "Space" });
            }
        }

        /* --------------------------------------------------------- wiring -- */

        _wireToolbar() {
            this.querySelector(".br-open").addEventListener("click", () => this._open());
            this._saveBtn.addEventListener("click", () => this._save());
            this._copyBtn.addEventListener("click", () => this._copy());
            this._undoBtn.addEventListener("click", () => this._undoStep());
            this._redoBtn.addEventListener("click", () => this._redoStep());
            this.querySelector(".br-fit").addEventListener("click", () => this._pz.reset());
            this.querySelector(".br-keys").addEventListener("click", () =>
                sac.shortcuts?.show({ title: "Background Remover shortcuts" }));
            this.querySelector(".br-credits").addEventListener("click", () => this._about());
            this.querySelector(".br-help-btn").addEventListener("click", () => this.querySelector(".br-help-win").open());
        }

        /** Kit events only — composed native events from shadow inputs carry no detail. */
        _on(el, type, fn) {
            el.addEventListener(type, (e) => { if (e.detail != null) fn(e.detail.value); });
        }

        _wireControls() {
            const ui = this.ui;
            const rerender = () => { if (this._mask) this._render(); };

            this._on(ui.bgMode, "sac:change", (v) => {
                ui.bgColor.toggleAttribute("disabled", v !== "color");
                rerender();
            });
            this._on(ui.bgColor, "sac:change", rerender);
            this._on(ui.crop, "sac:change", rerender);
            this._on(ui.cut, "sac:input", () => this._scheduleRender());
            this._on(ui.feather, "sac:input", () => this._scheduleRender());

            this._on(ui.model, "sac:change", async (v) => {
                if (!this._image) { this._modelKey = v; return; }
                // A re-run replaces the mask — hand edits would be gone.
                if (!(await this._discardOk())) { ui.model.value = this._modelKey; return; }
                this._modelKey = v;
                this._infer();
            });
            this._on(ui.tool, "sac:change", (v) => {
                const wand = v === "wand";
                this._paneSrc.classList.toggle("wand-mode", wand);
                ui.wand.hidden = !wand;
            });
            this.querySelector(".br-reset").addEventListener("click", () => {
                if (!this._baseMask) return;
                this._pushHistory();
                this._mask = this._baseMask.slice();
                this._render();
                this._setDirty(true);
            });
        }

        _wireDrop() {
            const stage = this._stage;
            ["dragenter", "dragover"].forEach((ev) =>
                stage.addEventListener(ev, (e) => { e.preventDefault(); stage.classList.add("dragover"); }));
            ["dragleave", "drop"].forEach((ev) =>
                stage.addEventListener(ev, (e) => { e.preventDefault(); stage.classList.remove("dragover"); }));
            stage.addEventListener("drop", (e) => {
                if (e.composedPath().some((n) => n.tagName === "SAC-DROP-ZONE")) return;   // the zone handles its own
                const file = e.dataTransfer?.files?.[0];
                if (file) this._loadFile(file);
            });
        }

        _setReady(ready) {
            this._saveBtn.disabled = !ready;
            this._copyBtn.disabled = !ready;
        }

        /* ------------------------------------------------------------ files -- */

        async _open() {
            const picked = await this._ctx.files.open({ accept: ACCEPT, title: "Open image" });
            if (picked) this._loadFile(picked.file);
        }

        _paste(e) {
            const item = [...(e.clipboardData?.items || [])].find((it) => it.type.startsWith("image/"));
            const file = item?.getAsFile();
            if (!file) return;
            e.preventDefault();
            this._loadFile(new File([file], "pasted.png", { type: file.type }));
        }

        async _loadFile(file) {
            if (!file || !file.type.startsWith("image/")) {
                sac.toast?.("That is not an image.", { kind: "warn" });
                return;
            }
            if (!(await this._discardOk())) return;
            this._name = (file.name && file.name.replace(/\.[^.]+$/, "")) || "cutout";
            const url = URL.createObjectURL(file);
            try {
                const tf = await loadTransformers();
                const image = await tf.RawImage.fromURL(url);
                this._image = image;
                const w = image.width, h = image.height;
                this._dims = { w, h };

                const c = this._srcCanvas;
                c.width = w;
                c.height = h;
                const sctx = c.getContext("2d");
                sctx.clearRect(0, 0, w, h);
                sctx.drawImage(image.toCanvas(), 0, 0);
                this._rgba = sctx.getImageData(0, 0, w, h).data;
                this._mask = null;
                this._stage.classList.add("has-image");
                this._pz.reset();
                await this._infer();
            } catch (err) {
                console.error("[background-remover] could not load the image:", err);
                sac.toast?.("Could not read that image.", { kind: "error" });
            } finally {
                URL.revokeObjectURL(url);
            }
        }

        _outputBlob() {
            return new Promise((resolve) => this._outCanvas.toBlob(resolve, "image/png"));
        }

        async _save() {
            if (!this._mask) return;
            const blob = await this._outputBlob();
            if (!blob) return;
            try {
                const saved = await this._ctx.files.save(blob, {
                    name: this._name + "_cutout.png", accept: ".png", title: "Save cut-out",
                });
                if (!saved) return;
                this._setDirty(false);
                sac.toast?.(`Saved ${saved.name}`, { kind: "success" });
            } catch (err) {
                console.error("[background-remover] save failed:", err);
                sac.toast?.("Saving failed.", { kind: "error" });
            }
        }

        async _copy() {
            try {
                const blob = await this._outputBlob();
                await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
                sac.toast?.("Cut-out copied.", { kind: "success" });
            } catch (err) {
                console.warn("[background-remover] clipboard write failed:", err);
                sac.toast?.("The clipboard refused.", { kind: "error" });
            }
        }

        /* -------------------------------------------------------- inference -- */

        _progress(label, pct) {
            this._busyLabel.textContent = label;
            if (pct == null) this._bar.setAttribute("indeterminate", "");
            else { this._bar.removeAttribute("indeterminate"); this._bar.value = String(Math.round(pct)); }
        }

        async _ensureModel(key) {
            if (this._loaded[key]) return this._loaded[key];
            if (this._loading[key]) return this._loading[key];
            const m = MODELS[key];
            this._loading[key] = (async () => {
                const tf = await loadTransformers();
                const pc = (e) => {
                    if (e.status === "progress" && typeof e.progress === "number") {
                        this._progress(`Downloading ${m.label}… ${Math.round(e.progress)}%`, e.progress);
                    }
                };
                const tryDevice = async (device) => ({
                    model: await m.load(tf, device, pc),
                    processor: await m.processor(tf, pc),
                    device,
                });
                const dev = m.device || (navigator.gpu ? "webgpu" : "wasm");
                let res;
                try {
                    res = await tryDevice(dev);
                } catch (err) {
                    if (dev === "wasm") throw err;
                    console.warn(`[background-remover] ${m.label} failed on ${dev}, falling back to WASM:`, err);
                    res = await tryDevice("wasm");
                }
                this._loaded[key] = res;
                return res;
            })();
            try { return await this._loading[key]; }
            finally { delete this._loading[key]; }
        }

        async _infer() {
            if (!this._image) return;
            const run = ++this._runId;
            const key = this.ui.model.value;
            const m = MODELS[key];

            this._busy.hidden = false;
            this._progress("Loading model…", null);
            this._setReady(false);

            try {
                const tf = await loadTransformers();
                let entry = await this._ensureModel(key);
                this._progress("Removing background…", null);
                await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

                const image = this._image;
                const exec = async (e) => {
                    const { pixel_values } = await e.processor(image);
                    return e.model({ input: pixel_values });
                };
                let out;
                try {
                    out = await exec(entry);
                } catch (err) {
                    // Some models fail at runtime on WebGPU — retry once on WASM.
                    if (entry.device === "wasm") throw err;
                    console.warn(`[background-remover] inference failed on ${entry.device}, retrying on WASM:`, err);
                    this._progress("Retrying on CPU…", null);
                    entry = { model: await m.load(tf, "wasm"), processor: await m.processor(tf), device: "wasm" };
                    this._loaded[key] = entry;
                    out = await exec(entry);
                }
                if (run !== this._runId) return;   // a newer image or model took over

                this._device.textContent = `▸ ${m.label} · ${entry.device.toUpperCase()}`;
                const t = out.output ?? Object.values(out)[0];
                const mask = await tf.RawImage.fromTensor(t[0].mul(255).to("uint8")).resize(this._dims.w, this._dims.h);
                this._mask = mask.data;
                this._baseMask = this._mask.slice();
                this._setDirty(false);
                this._undo.length = 0;
                this._redo.length = 0;
                this._syncHistory();
                this._render();
            } catch (err) {
                if (run !== this._runId) return;
                console.error("[background-remover] background removal failed:", err);
                sac.toast?.("Background removal failed — see the console.", { kind: "error" });
            }
            if (run === this._runId) this._busy.hidden = true;
        }

        /* ----------------------------------------------------------- render -- */

        _scheduleRender() {
            clearTimeout(this._renderTimer);
            this._renderTimer = setTimeout(() => { if (this._mask) this._render(); }, 60);
        }

        /** Compose the cut-out from the mask — cheap, no inference. */
        _render() {
            if (!this._mask || !this._rgba) return;
            const { w, h } = this._dims;
            const n = w * h;
            const rgba = this._rgba;

            // 1. Cutoff — 0 keeps the model's soft matte (best for hair).
            const cut = parseInt(this.ui.cut.value, 10);
            let alpha = this._mask;
            if (cut > 0) {
                const c = (cut / 100) * 255;
                alpha = new Uint8ClampedArray(n);
                for (let i = 0; i < n; i++) alpha[i] = this._mask[i] < c ? 0 : 255;
            }

            // 2. Feather.
            const feather = parseFloat(this.ui.feather.value);
            if (feather > 0) alpha = blurAlpha(alpha, w, h, feather);

            // 3. The RGBA cut-out.
            const cutout = new ImageData(w, h);
            for (let i = 0; i < n; i++) {
                cutout.data[4 * i] = rgba[4 * i];
                cutout.data[4 * i + 1] = rgba[4 * i + 1];
                cutout.data[4 * i + 2] = rgba[4 * i + 2];
                cutout.data[4 * i + 3] = alpha[i];
            }

            // 4. Auto-crop bounds.
            let x0 = 0, y0 = 0, x1 = w, y1 = h;
            if (this.ui.crop.checked) {
                x0 = w; y0 = h; x1 = 0; y1 = 0;
                for (let y = 0; y < h; y++) {
                    for (let x = 0; x < w; x++) {
                        if (alpha[y * w + x] > 10) {
                            if (x < x0) x0 = x; if (x > x1) x1 = x;
                            if (y < y0) y0 = y; if (y > y1) y1 = y;
                        }
                    }
                }
                if (x1 < x0 || y1 < y0) { x0 = 0; y0 = 0; x1 = w - 1; y1 = h - 1; }
                x1 += 1; y1 += 1;
            }
            const cw = x1 - x0, ch = y1 - y0;

            // 5. Paint — through a temp canvas so a solid fill composites under alpha.
            const tmp = document.createElement("canvas"); tmp.width = w; tmp.height = h;
            tmp.getContext("2d").putImageData(cutout, 0, 0);
            const oc = this._outCanvas;
            oc.width = cw;
            oc.height = ch;
            const octx = oc.getContext("2d");
            octx.clearRect(0, 0, cw, ch);
            const solid = this.ui.bgMode.value === "color";
            if (solid) {
                octx.fillStyle = this.ui.bgColor.value;
                octx.fillRect(0, 0, cw, ch);
            }
            octx.drawImage(tmp, x0, y0, cw, ch, 0, 0, cw, ch);

            this._stage.setAttribute("data-bg", solid ? "solid" : "checker");
            this._setReady(true);
        }

        /* ------------------------------------------------ the app shell ---- *
         * Shared by the four DREAM-TOOLS-born apps (vectorizer, background-
         * remover, mesh-optimizer, svg-to-3d) — keep the copies in step.
         *   · settings: every control with data-keep is remembered in
         *     context.fs ("settings") and restored by replaying its event;
         *   · credits: sac.about from the manifest (notices included);
         *   · the empty state is a sac-drop-zone whose click goes through
         *     context.files (the host's file space), not the device picker.
         * ------------------------------------------------------------------ */

        _keepValue(el) {
            return el.tagName === "SAC-TOGGLE" ? el.checked : el.value;
        }

        async _restoreSettings() {
            let saved = null;
            try { saved = await this._ctx.fs?.read("settings", null); } catch { saved = null; }
            if (saved && typeof saved === "object") {
                for (const el of this.querySelectorAll("[data-keep]")) {
                    const key = el.dataset.keep;
                    if (!(key in saved)) continue;
                    const v = saved[key];
                    const fire = (type, value) => el.dispatchEvent(new CustomEvent(type, { detail: { value }, bubbles: true }));
                    if (el.tagName === "SAC-TOGGLE") { el.checked = !!v; fire("sac:change", !!v); }
                    else if (el.tagName === "INPUT") { el.value = v; el.dispatchEvent(new Event("input", { bubbles: true })); }
                    else if (el.tagName === "SAC-SLIDER") { el.value = String(v); fire("sac:input", String(v)); fire("sac:change", String(v)); }
                    else { el.value = String(v); fire("sac:change", String(v)); }
                }
            }
            // Watch only after restoring, so the replay above does not write back.
            const save = () => {
                clearTimeout(this._keepTimer);
                this._keepTimer = setTimeout(() => {
                    const out = {};
                    for (const el of this.querySelectorAll("[data-keep]")) out[el.dataset.keep] = this._keepValue(el);
                    Promise.resolve(this._ctx.fs?.write("settings", out)).catch(() => {});
                }, 400);
            };
            for (const el of this.querySelectorAll("[data-keep]")) {
                for (const type of ["sac:change", "sac:input", "input"]) el.addEventListener(type, save);
            }
        }

        async _about() {
            if (!this._manifest) {
                this._manifest = this._ctx.manifest
                    || await fetch(BASE + "app.json").then((r) => r.json()).catch(() => null);
            }
            if (sac.about) sac.about.open(this._manifest || { name: this.tagName.toLowerCase() });
        }

        _wireDropZone(onFile) {
            const wrap = this.querySelector(".app-drop");
            const zone = wrap.querySelector("sac-drop-zone");
            // Click / Enter / Space open through context.files, like the Open button.
            const intercept = (e) => {
                if (e.type === "keydown" && e.key !== "Enter" && e.key !== " ") return;
                if (!e.composedPath().includes(zone)) return;
                e.preventDefault();
                e.stopPropagation();
                this._open();
            };
            wrap.addEventListener("click", intercept, true);
            wrap.addEventListener("keydown", intercept, true);
            zone.addEventListener("sac:files", (e) => { const f = e.detail.files[0]; if (f) onFile(f); });
            zone.addEventListener("sac:rejected", () => sac.toast?.("That file type does not open here.", { kind: "warn" }));
        }

        /** Ctrl+O / Ctrl+S — only while the app is on screen. */
        _registerFileKeys(saveFn) {
            const offs = [
                sac.hotkeys.register("mod+o", () => this._open(), { group: "File", description: "Open" }),
                sac.hotkeys.register("mod+s", () => saveFn(), { group: "File", description: "Save / export" }),
            ];
            return () => offs.forEach((off) => off());
        }

        /* ------------------------------------------------------- magic wand -- */

        _wireWand() {
            const c = this._srcCanvas;
            const isWand = () => this.ui.tool.value === "wand" && !this._spaceHeld;
            const apply = (e, button) => {
                const primary = this.ui.wandMode.value;
                const mode = button === 2 ? (primary === "remove" ? "restore" : "remove") : primary;
                const r = c.getBoundingClientRect();
                this._magicWand(
                    Math.floor((e.clientX - r.left) * (c.width / r.width)),
                    Math.floor((e.clientY - r.top) * (c.height / r.height)),
                    mode);
            };
            // Mouse: the pane pans on mousedown — stop it from reaching the pane.
            c.addEventListener("mousedown", (e) => {
                if (!isWand() || (e.button !== 0 && e.button !== 2)) return;
                e.preventDefault();
                e.stopPropagation();
                apply(e, e.button);
            });
            // Touch and pen: the pane pans on pointerdown — a tap here is the wand.
            c.addEventListener("pointerdown", (e) => {
                if (e.pointerType === "mouse" || !isWand()) return;
                e.stopPropagation();
                apply(e, 0);
            });
            c.addEventListener("contextmenu", (e) => { if (this.ui.tool.value === "wand") e.preventDefault(); });
        }

        _magicWand(sx, sy, mode) {
            if (!this._mask || !this._rgba) return;
            const { w, h } = this._dims;
            if (sx < 0 || sy < 0 || sx >= w || sy >= h) return;
            const rgba = this._rgba;

            this._pushHistory();
            this._setDirty(true);
            const before = this._undo[this._undo.length - 1];   // pre-edit alpha, for the soft blend

            const seed = sy * w + sx;
            const sr = rgba[seed * 4], sg = rgba[seed * 4 + 1], sb = rgba[seed * 4 + 2];
            const tol = (parseInt(this.ui.tol.value, 10) / 100) * 765;   // L1 colour distance
            const target = mode === "restore" ? 255 : 0;

            // Flood fill: the contiguous similar-coloured region.
            const region = new Uint8Array(w * h);
            const stack = [seed];
            region[seed] = 1;
            while (stack.length) {
                const idx = stack.pop();
                const x = idx % w, y = (idx - x) / w;
                const nbrs = [];
                if (x > 0) nbrs.push(idx - 1);
                if (x < w - 1) nbrs.push(idx + 1);
                if (y > 0) nbrs.push(idx - w);
                if (y < h - 1) nbrs.push(idx + w);
                for (const nb of nbrs) {
                    if (region[nb]) continue;
                    const o = nb * 4;
                    const d = Math.abs(rgba[o] - sr) + Math.abs(rgba[o + 1] - sg) + Math.abs(rgba[o + 2] - sb);
                    if (d <= tol) { region[nb] = 1; stack.push(nb); }
                }
            }

            const feather = parseFloat(this.ui.wandFeather.value);
            const mask = this._mask;
            if (feather > 0) {
                // Blur the membership into 0..1 and blend across the boundary,
                // so the new edge feathers instead of stair-stepping.
                const m = blurAlpha(region.map((v) => (v ? 255 : 0)), w, h, feather);
                for (let i = 0; i < w * h; i++) {
                    if (m[i] > 0) {
                        const a = m[i] / 255;
                        mask[i] = Math.round(before[i] * (1 - a) + target * a);
                    }
                }
            } else {
                for (let i = 0; i < w * h; i++) if (region[i]) mask[i] = target;
            }
            this._render();
        }

        /* ---------------------------------------------------------- history -- */

        /* ---------------------------------------------------- unsaved work -- */

        _setDirty(on) {
            this._dirty = !!on;
            this._ctx.setDirty?.(this._dirty);
        }

        /** Hand edits not saved yet? Ask before throwing them away → true to go on. */
        async _discardOk() {
            if (!this._dirty) return true;
            const a = await sac.dialog.confirm({
                title: "Discard unsaved changes?",
                message: `${this._name}_cutout.png`,
                buttons: [
                    { action: "cancel", label: "Cancel", kind: "default" },
                    { action: "discard", label: "Discard", kind: "destructive" },
                ],
            });
            if (a !== "discard") return false;
            this._setDirty(false);
            return true;
        }

        _syncHistory() {
            this._undoBtn.disabled = this._undo.length === 0;
            this._redoBtn.disabled = this._redo.length === 0;
        }

        _pushHistory() {
            if (!this._mask) return;
            this._undo.push(this._mask.slice());
            if (this._undo.length > HISTORY_MAX) this._undo.shift();
            this._redo.length = 0;   // a new edit cuts off the redo branch
            this._syncHistory();
        }

        _undoStep() {
            if (!this._undo.length) return;
            this._redo.push(this._mask.slice());
            this._mask = this._undo.pop();
            this._render();
            this._syncHistory();
            this._setDirty(true);
        }

        _redoStep() {
            if (!this._redo.length) return;
            this._undo.push(this._mask.slice());
            this._mask = this._redo.pop();
            this._render();
            this._syncHistory();
            this._setDirty(true);
        }

        /* ------------------------------------------------------ space = pan -- */

        _keyDown(e) {
            if (e.code !== "Space" || this._spaceHeld) return;
            const t = e.composedPath?.()[0] || e.target;
            if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(t.tagName))) return;
            this._spaceHeld = true;
            this._paneSrc.classList.add("space-pan");
            e.preventDefault();
        }

        _keyUp(e) {
            if (e.code !== "Space") return;
            this._spaceHeld = false;
            this._paneSrc?.classList.remove("space-pan");
        }
    }

    sac.app.define("app-background-remover", AppBackgroundRemover);
})();
