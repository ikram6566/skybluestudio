# Sky Blue Studio — Batch Photo Branding Tool

A small, dependency-free web tool: load a folder of photos, it crops each one
to a size you choose, nudges the **brightness** up, and stamps your **logo**
at whatever position/opacity/size you set, then hands back every processed
photo (individually and as a zip). Also flags photos that look dark or blurry
before you post them. Runs entirely in the browser — no server, no upload, no
image-hosting cost.

## Run it locally

No build step. Any static file server works:

```bash
npx serve .
# or
python3 -m http.server 8000
```

Then open the printed URL and try it with a few test photos.

## Deploy: GitHub → Vercel

1. Push this folder to a new GitHub repo:
   ```bash
   git init
   git add .
   git commit -m "Batch photo branding tool"
   git branch -M main
   git remote add origin https://github.com/<you>/<repo>.git
   git push -u origin main
   ```
2. In Vercel: **Add New Project** → import that repo.
3. Framework preset: choose **Other** (it's a static site — Vercel will just
   serve the files as-is, no build command needed).
4. Deploy. That's it — you'll get a live `*.vercel.app` URL.

## What it actually does, precisely

1. On load, the page auto-loads a bundled default logo
   (`assets/sky-blue-logo.png` — swap this file to change the default, or
   just pick a different one in the browser any time). You can pick a
   folder of photos and go straight to processing without uploading a logo
   every time.
2. You pick a folder (or files) of JPG/PNG/WebP photos.
3. Choose a **frame size preset**: Marketplace/Website (1024×768), Instagram
   Square (1080×1080), Instagram Portrait (1080×1350), Print Flyer
   (1800×1200), or a **Custom** width/height. Only applies in "Fill frame"
   or "Fit whole photo" crop modes — ignored entirely in "Don't crop."
4. For each photo:
   - Crops/resizes per your chosen crop mode:
     - **Fill frame** (default): scales to cover the chosen frame size and
       crops overflow from the centre.
     - **Fit whole photo**: scales to fit entirely inside the frame,
       letterboxed with white bars.
     - **Don't crop**: skips resizing entirely — keeps each photo's own
       original dimensions (frame size preset is ignored in this mode).
   - Applies a brightness boost (slider, default 112%; 100% = untouched).
   - Draws your logo at your chosen **position** — Center, one of four
     corners, or Bottom Center (a horizontal "banner" placement) — and
     opacity (default 49%), sized as a % of that photo's own output width.
     Corner/bottom placements exist specifically so the logo doesn't have
     to sit on top of whatever's most important in the shot.
   - If **quality flagging** is on (default), each source photo is scanned
     with a cheap heuristic for darkness and blur before any edits, and
     flagged photos get a `DARK` / `BLURRY` badge in the results grid plus
     a summary count. This is a rough heuristic (mean luminance + a
     discrete-Laplacian sharpness proxy on a downscaled copy) — expect
     some false positives/negatives, treat it as "worth a second look,"
     not a verdict.
5. Exports each as JPEG (default) or PNG, renames it
   `originalname_WIDTHxHEIGHT.jpg` using the actual output dimensions.
6. Lets you download everything at once as a `.zip`, or grab individual
   files from the on-page contact sheet.
7. **All slider/dropdown settings are remembered** in your browser's
   `localStorage` between visits — brightness, opacity, logo size/position,
   crop mode, frame preset, format, and the quality-flag toggle. Photo
   files and a custom logo you upload are *not* remembered (not practical
   or private-by-default to persist that way) — only the default bundled
   logo re-loads automatically each visit.

## Honest caveats

- **The "92 PPI" part is metadata only, not a real effect.** Pixel density
  (PPI/DPI) is a print-era concept; on the web, only pixel dimensions
  (1024×768) matter. For JPEG output, the tool patches the file's JFIF
  header so image editors like Photoshop *report* 92 PPI — but browsers,
  `<img>` tags, and Vercel don't look at that field at all. PNG output does
  **not** get this stamp (added complexity for zero practical benefit).
- **Large batches are limited by your browser's memory**, not by any limit
  this code imposes. A few hundred photos at typical phone-camera
  resolutions should be fine on a modern laptop; if you routinely process
  thousands, a server-side batch script (e.g. Node + `sharp`) would be more
  robust than a browser tab.
- **"A little bit bright" is subjective** — the brightness slider defaults
  to 112%, but you should eyeball the contact sheet output and adjust; it's
  not calibrated to any particular target.
- No EXIF data is preserved (orientation, camera info, GPS, etc. is
  stripped by the canvas re-encode). If you need original EXIF orientation
  respected, say so and it can be added — right now photos are read as the
  browser decodes them, which normally already applies EXIF orientation
  correctly, but nothing else survives.
- **The dark/blurry flags are a rough heuristic, not real quality
  detection.** A genuinely artistic dark shot, a deliberately soft-focus
  photo, or a busy patterned surface (which can spike the "sharp" score
  even when actually blurry) can all get mis-flagged. Treat the badges as
  "glance at this one again," not "delete this one" — and turn the toggle
  off entirely if it's producing more noise than signal for your photos.
- **Settings persistence uses `localStorage`, scoped to one browser on one
  device.** If you use this tool from your phone and your laptop, each
  remembers its own last-used settings independently — they don't sync.
  Clearing browser data/cache will also reset it back to defaults.
- **The bundled default logo was modified from the file you uploaded.**
  Your original PNG's alpha channel maxed out at ~51% (130/255) instead of
  fully opaque — meaning it was already partially transparent before the
  tool touches it. Stacking the tool's 49% opacity slider on top of that
  would land around 25% effective opacity, not 49%. `assets/sky-blue-logo.png`
  is your logo with the alpha channel stretched back to full range (same
  shape, same colors) so the opacity slider means what it says. If you
  replace this file, use a source PNG with fully opaque (255) alpha where
  the logo should be visible, and let the slider control transparency.

## Stack

Plain HTML/CSS/JS. Zip packaging via [JSZip](https://stuk.github.io/jszip/)
(loaded from a CDN). No React, no build tooling, no backend — intentionally,
so it's a two-minute Vercel deploy.
