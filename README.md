# Background Remover

Cut the background out of any photo with AI — soft hair matting for
portraits, crisp edges for objects. Runs 100% in your browser: no upload, no
account, no cost. Built on
[SACRVM APPKIT](https://github.com/SACRVM/sacrvm-appkit); runs standalone or
as an app on a SACRVM desktop.

```bash
npx serve .
```

## What it does

The original and the cut-out sit side by side and zoom and pan together.

- **Two models:** General (RMBG-1.4) for objects, products and most photos;
  Hair (MODNet) for people. Switching re-runs at once. The first run
  downloads the model (~26–44 MB); the browser caches it after that.
- **Output:** transparent or a solid fill colour, optional auto-crop to the
  subject.
- **Edge:** a mask cutoff hardens edges, feather softens them.
- **Magic wand:** click a region on the original to flood-fill a
  similar-coloured area and remove it — or restore it. Right-click does the
  opposite; undo / redo with Ctrl+Z / Ctrl+Y.
- **In:** open, drop or paste (Ctrl+V) an image. **Out:** save a PNG or copy
  it — straight into the [Vectorizer](https://github.com/SACRVM/vectorizer)
  to turn the cut-out into an SVG silhouette.

## Install on a desktop

Paste `github.com/SACRVM/background-remover` into a SACRVM desktop's install
dialog, or pick it from the App Store tab there.

## Credits

- [transformers.js](https://github.com/huggingface/transformers.js)
  (Apache-2.0), loaded from jsDelivr on first use.
- [RMBG-1.4](https://huggingface.co/briaai/RMBG-1.4) by BRIA AI —
  **non-commercial** licence; commercial use needs an agreement with BRIA.
- [MODNet](https://github.com/ZHKKKe/MODNet) (Apache-2.0), via
  [Xenova/modnet](https://huggingface.co/Xenova/modnet).

The models are downloaded from the Hugging Face Hub at runtime; none of them
ships in this repository.

## License

MIT — see `LICENSE` (the app's own code; the models keep their own licences).
