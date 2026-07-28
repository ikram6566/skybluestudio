/* ------------------------------------------------------------------
   Manual "clean up" editor — brush over a small unwanted object and
   fill it in with a local, non-AI algorithm (pyramid diffusion fill).

   Honest scope: this is NOT AI inpainting. It has no idea what a wall,
   a cable, or a cushion is — it just spreads nearby colors inward from
   the edges of whatever you marked. That works reasonably well for
   small objects sitting on a plain, low-detail surface (wall, floor,
   ceiling) and looks smudgy on patterned or complex backgrounds or
   large objects. It's a quick manual touch-up tool, not a guarantee.
------------------------------------------------------------------- */

// original File -> { blob, url, name }. Read by script.js's
// processOneFile() so the edited version is used instead of the
// original when the batch runs.
const cleanupOverrides = new Map();

const MAX_EDIT_DIMENSION = 2000; // cap working resolution for speed

const gridEl = document.getElementById("photo-grid");

const modalEl = document.getElementById("cleanup-modal");
const filenameEl = document.getElementById("cleanup-filename");
const closeBtn = document.getElementById("cleanup-close");
const canvasWrap = document.getElementById("cleanup-canvaswrap");
const imgCanvas = document.getElementById("cleanup-canvas");
const maskCanvas = document.getElementById("cleanup-mask-canvas");
const brushSizeInput = document.getElementById("cleanup-brush-size");
const undoBtn = document.getElementById("cleanup-undo");
const resetBtn = document.getElementById("cleanup-reset");
const autocleanBtn = document.getElementById("cleanup-autoclean");
const applyBtn = document.getElementById("cleanup-apply");
const saveBtn = document.getElementById("cleanup-save");
const statusEl = document.getElementById("cleanup-status");

const autocleanBarEl = document.getElementById("autoclean-bar");
const autocleanAllBtn = document.getElementById("btn-autoclean-all");
const autocleanSensitivityGroup = document.getElementById("ctl-autosensitivity");
const autocleanStatusEl = document.getElementById("autoclean-status");

// Threshold (on a 0-255 high-frequency difference map) below which a pixel
// is considered "flat like its surroundings" and above which it's flagged
// as a possible blemish. Lower number = more sensitive = flags more spots.
const AUTO_SENSITIVITY_THRESHOLD = { low: 55, medium: 38, high: 24 };
let autoSensitivity = "medium";

const imgCtx = imgCanvas.getContext("2d");
const maskCtx = maskCanvas.getContext("2d");

let currentFile = null;
let originalImageData = null; // the pristine loaded image, for "Reset"
let strokeGroups = [];        // for undo — array of arrays of {x,y}
let activeStroke = null;
let isDrawing = false;

// ---- grid of loaded photos, with a "Clean up" button per photo -------
function renderPhotoGrid(files) {
  // drop overrides for files no longer in the current selection
  const liveSet = new Set(files);
  for (const key of [...cleanupOverrides.keys()]) {
    if (!liveSet.has(key)) {
      URL.revokeObjectURL(cleanupOverrides.get(key).url);
      cleanupOverrides.delete(key);
    }
  }

  gridEl.innerHTML = "";
  if (!files.length) {
    gridEl.hidden = true;
    autocleanBarEl.hidden = true;
    autocleanStatusEl.hidden = true;
    return;
  }
  gridEl.hidden = false;
  autocleanBarEl.hidden = false;

  files.forEach((file) => {
    const override = cleanupOverrides.get(file);
    const previewUrl = override ? override.url : URL.createObjectURL(file);
    const badgeClass = override && override.auto ? "photo-cell__badge photo-cell__badge--auto" : "photo-cell__badge";
    const badgeText = override ? (override.auto ? "AUTO-CLEANED" : "CLEANED") : "";

    const cell = document.createElement("div");
    cell.className = "photo-cell";
    cell.innerHTML = `
      <img src="${previewUrl}" alt="${file.name}" />
      ${override ? `<span class="${badgeClass}">${badgeText}</span>` : ""}
      <div class="photo-cell__btns">
        <button type="button" class="photo-cell__btn" data-role="manual">Clean up</button>
        <button type="button" class="photo-cell__btn" data-role="auto">Auto clean</button>
      </div>
    `;
    cell.querySelector('[data-role="manual"]').addEventListener("click", () => openCleanupModal(file));
    cell.querySelector('[data-role="auto"]').addEventListener("click", (e) => runAutoCleanForFile(file, e.currentTarget));
    gridEl.appendChild(cell);
  });
}
window.renderPhotoGrid = renderPhotoGrid;

// ---- sensitivity control (shared by grid buttons, "auto-clean all", and
// the in-modal auto-clean button) ---------------------------------------
autocleanSensitivityGroup.addEventListener("click", (e) => {
  const btn = e.target.closest(".segmented__opt");
  if (!btn) return;
  autoSensitivity = btn.dataset.sens;
  [...autocleanSensitivityGroup.children].forEach((c) =>
    c.classList.toggle("is-active", c === btn)
  );
});

// ---- modal open/close -------------------------------------------------
async function openCleanupModal(file) {
  currentFile = file;
  filenameEl.textContent = file.name;
  statusEl.textContent = "";

  const override = cleanupOverrides.get(file);
  const source = override ? override.blob : file;

  const img = new Image();
  const url = URL.createObjectURL(source);
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = reject;
    img.src = url;
  });

  let w = img.naturalWidth || img.width;
  let h = img.naturalHeight || img.height;
  if (Math.max(w, h) > MAX_EDIT_DIMENSION) {
    const scale = MAX_EDIT_DIMENSION / Math.max(w, h);
    w = Math.round(w * scale);
    h = Math.round(h * scale);
  }

  imgCanvas.width = w;
  imgCanvas.height = h;
  maskCanvas.width = w;
  maskCanvas.height = h;

  imgCtx.clearRect(0, 0, w, h);
  imgCtx.drawImage(img, 0, 0, w, h);
  URL.revokeObjectURL(url);

  originalImageData = imgCtx.getImageData(0, 0, w, h);
  clearMask();

  modalEl.hidden = false;
}

function closeModal() {
  modalEl.hidden = true;
  currentFile = null;
  originalImageData = null;
  clearMask();
}

closeBtn.addEventListener("click", closeModal);
modalEl.addEventListener("click", (e) => {
  if (e.target === modalEl) closeModal();
});

// ---- brush drawing on the mask canvas ---------------------------------
function canvasPointFromEvent(e) {
  const rect = maskCanvas.getBoundingClientRect();
  const scaleX = maskCanvas.width / rect.width;
  const scaleY = maskCanvas.height / rect.height;
  return {
    x: (e.clientX - rect.left) * scaleX,
    y: (e.clientY - rect.top) * scaleY,
  };
}

function redrawMaskFromStrokes() {
  maskCtx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
  maskCtx.strokeStyle = "#ff2d2d";
  maskCtx.fillStyle = "#ff2d2d";
  maskCtx.lineCap = "round";
  maskCtx.lineJoin = "round";
  strokeGroups.forEach((stroke) => {
    if (!stroke.points.length) return;
    maskCtx.lineWidth = stroke.size;
    if (stroke.points.length === 1) {
      const p = stroke.points[0];
      maskCtx.beginPath();
      maskCtx.arc(p.x, p.y, stroke.size / 2, 0, Math.PI * 2);
      maskCtx.fill();
      return;
    }
    maskCtx.beginPath();
    maskCtx.moveTo(stroke.points[0].x, stroke.points[0].y);
    for (let i = 1; i < stroke.points.length; i++) {
      maskCtx.lineTo(stroke.points[i].x, stroke.points[i].y);
    }
    maskCtx.stroke();
  });
}

function clearMask() {
  strokeGroups = [];
  activeStroke = null;
  maskCtx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
}

maskCanvas.addEventListener("pointerdown", (e) => {
  if (!currentFile) return;
  isDrawing = true;
  maskCanvas.setPointerCapture(e.pointerId);
  const p = canvasPointFromEvent(e);
  activeStroke = { size: Number(brushSizeInput.value), points: [p] };
  strokeGroups.push(activeStroke);
  redrawMaskFromStrokes();
});
maskCanvas.addEventListener("pointermove", (e) => {
  if (!isDrawing || !activeStroke) return;
  const p = canvasPointFromEvent(e);
  activeStroke.points.push(p);
  redrawMaskFromStrokes();
});
function endStroke() {
  isDrawing = false;
  activeStroke = null;
}
maskCanvas.addEventListener("pointerup", endStroke);
maskCanvas.addEventListener("pointerleave", endStroke);
maskCanvas.addEventListener("pointercancel", endStroke);

undoBtn.addEventListener("click", () => {
  strokeGroups.pop();
  redrawMaskFromStrokes();
});

resetBtn.addEventListener("click", () => {
  if (!originalImageData) return;
  imgCtx.putImageData(originalImageData, 0, 0);
  clearMask();
  statusEl.textContent = "Reverted to the image as it was when this editor opened.";
});

// ---- fill algorithm: pyramid / multi-resolution diffusion -------------
// Not AI. Spreads known (unmasked) colors inward from the edges of the
// masked region, coarse-to-fine, so it converges fast and stays smooth.
// Good for small marks on plain surfaces; poor on texture/pattern.

function buildLevels(rgb, mask, w, h) {
  const levels = [{ rgb, mask, w, h }];
  let curRgb = rgb, curMask = mask, curW = w, curH = h;
  while (curW > 48 && curH > 48) {
    const nw = Math.max(1, Math.floor(curW / 2));
    const nh = Math.max(1, Math.floor(curH / 2));
    const nRgb = new Float32Array(nw * nh * 3);
    const nMask = new Uint8Array(nw * nh);

    for (let y = 0; y < nh; y++) {
      for (let x = 0; x < nw; x++) {
        const sx0 = x * 2, sy0 = y * 2;
        let sumR = 0, sumG = 0, sumB = 0, count = 0, total = 0;
        for (let dy = 0; dy < 2; dy++) {
          const sy = sy0 + dy;
          if (sy >= curH) continue;
          for (let dx = 0; dx < 2; dx++) {
            const sx = sx0 + dx;
            if (sx >= curW) continue;
            total++;
            const si = sy * curW + sx;
            if (!curMask[si]) {
              sumR += curRgb[si * 3];
              sumG += curRgb[si * 3 + 1];
              sumB += curRgb[si * 3 + 2];
              count++;
            }
          }
        }
        const di = y * nw + x;
        if (count > 0) {
          nRgb[di * 3] = sumR / count;
          nRgb[di * 3 + 1] = sumG / count;
          nRgb[di * 3 + 2] = sumB / count;
        }
        nMask[di] = count / total < 0.5 ? 1 : 0;
      }
    }
    levels.push({ rgb: nRgb, mask: nMask, w: nw, h: nh });
    curRgb = nRgb; curMask = nMask; curW = nw; curH = nh;
  }
  return levels;
}

function upsampleSeed(coarseRgb, cw, ch, fineRgb, fineMask, fw, fh) {
  for (let y = 0; y < fh; y++) {
    const sy = Math.min(ch - 1, Math.floor((y * ch) / fh));
    for (let x = 0; x < fw; x++) {
      const fi = y * fw + x;
      if (!fineMask[fi]) continue;
      const sx = Math.min(cw - 1, Math.floor((x * cw) / fw));
      const si = sy * cw + sx;
      fineRgb[fi * 3] = coarseRgb[si * 3];
      fineRgb[fi * 3 + 1] = coarseRgb[si * 3 + 1];
      fineRgb[fi * 3 + 2] = coarseRgb[si * 3 + 2];
    }
  }
}

function diffuse(rgb, mask, w, h, iterations) {
  // list of masked pixel indices, so each iteration only touches them
  const idxs = [];
  for (let i = 0; i < w * h; i++) if (mask[i]) idxs.push(i);
  if (!idxs.length) return;

  for (let it = 0; it < iterations; it++) {
    for (let k = 0; k < idxs.length; k++) {
      const i = idxs[k];
      const x = i % w, y = (i / w) | 0;
      let sumR = 0, sumG = 0, sumB = 0, n = 0;
      if (x > 0) { const j = i - 1; sumR += rgb[j * 3]; sumG += rgb[j * 3 + 1]; sumB += rgb[j * 3 + 2]; n++; }
      if (x < w - 1) { const j = i + 1; sumR += rgb[j * 3]; sumG += rgb[j * 3 + 1]; sumB += rgb[j * 3 + 2]; n++; }
      if (y > 0) { const j = i - w; sumR += rgb[j * 3]; sumG += rgb[j * 3 + 1]; sumB += rgb[j * 3 + 2]; n++; }
      if (y < h - 1) { const j = i + w; sumR += rgb[j * 3]; sumG += rgb[j * 3 + 1]; sumB += rgb[j * 3 + 2]; n++; }
      if (n === 0) continue;
      rgb[i * 3] = sumR / n;
      rgb[i * 3 + 1] = sumG / n;
      rgb[i * 3 + 2] = sumB / n;
    }
  }
}

function imageDataToRgb(imageData) {
  const { data, width, height } = imageData;
  const rgb = new Float32Array(width * height * 3);
  for (let i = 0, p = 0; i < data.length; i += 4, p += 3) {
    rgb[p] = data[i];
    rgb[p + 1] = data[i + 1];
    rgb[p + 2] = data[i + 2];
  }
  return rgb;
}

function rgbToImageData(rgb, w, h) {
  const out = new ImageData(w, h);
  for (let p = 0, i = 0; p < rgb.length; p += 3, i += 4) {
    out.data[i] = rgb[p];
    out.data[i + 1] = rgb[p + 1];
    out.data[i + 2] = rgb[p + 2];
    out.data[i + 3] = 255;
  }
  return out;
}

function runInpaint(imageData, maskAlpha, w, h) {
  const rgb = imageDataToRgb(imageData);
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) mask[i] = maskAlpha[i] > 10 ? 1 : 0;

  const levels = buildLevels(rgb, mask, w, h);

  let filledRgb = null, filledW = 0, filledH = 0;
  for (let li = levels.length - 1; li >= 0; li--) {
    const level = levels[li];
    if (filledRgb) {
      upsampleSeed(filledRgb, filledW, filledH, level.rgb, level.mask, level.w, level.h);
    }
    const iterations = li === levels.length - 1 ? 350 : 60;
    diffuse(level.rgb, level.mask, level.w, level.h, iterations);
    filledRgb = level.rgb;
    filledW = level.w;
    filledH = level.h;
  }

  return rgbToImageData(filledRgb, w, h);
}

// ---- automatic cleaning: detect + fill small isolated blemishes -------
// Honest scope: this does NOT understand objects. It flags small spots
// that look different from their immediate surroundings (dust specks,
// small marks, sensor spots) and fills only those — using the same
// diffusion fill as the manual tool. It deliberately ignores anything
// bigger than a small blemish (real furniture, people, edges of the
// room) so it won't eat large parts of a photo, but that also means it
// will miss bigger unwanted objects — those still need manual brushing.

function grayscaleOf(imageData, w, h) {
  const { data } = imageData;
  const gray = new Float32Array(w * h);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    gray[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }
  return gray;
}

// Fast separable box blur (two 1D passes) used as a "what the local area
// looks like without small spots" reference — pixels that stand out a lot
// from this blurred version are candidate blemishes.
function boxBlur(src, w, h, radius) {
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  const size = radius * 2 + 1;

  for (let y = 0; y < h; y++) {
    const rowOff = y * w;
    let sum = 0;
    for (let x = -radius; x <= radius; x++) sum += src[rowOff + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) {
      tmp[rowOff + x] = sum / size;
      const addX = Math.min(w - 1, x + radius + 1);
      const subX = Math.max(0, x - radius);
      sum += src[rowOff + addX] - src[rowOff + subX];
    }
  }
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let y = -radius; y <= radius; y++) sum += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = sum / size;
      const addY = Math.min(h - 1, y + radius + 1);
      const subY = Math.max(0, y - radius);
      sum += tmp[addY * w + x] - tmp[subY * w + x];
    }
  }
  return out;
}

function dilateMask(mask, w, h, iterations) {
  let cur = mask;
  for (let it = 0; it < iterations; it++) {
    const next = new Uint8ClampedArray(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (cur[i]) { next[i] = 255; continue; }
        const hit =
          (x > 0 && cur[i - 1]) ||
          (x < w - 1 && cur[i + 1]) ||
          (y > 0 && cur[i - w]) ||
          (y < h - 1 && cur[i + w]);
        next[i] = hit ? 255 : 0;
      }
    }
    cur = next;
  }
  return cur;
}

// Returns { mask: Uint8ClampedArray(w*h) of 0/255, count: number of spots }
function autoDetectMask(imageData, w, h, sensitivityKey) {
  const gray = grayscaleOf(imageData, w, h);
  const blurred = boxBlur(gray, w, h, 5);
  const threshold = AUTO_SENSITIVITY_THRESHOLD[sensitivityKey] ?? AUTO_SENSITIVITY_THRESHOLD.medium;

  const binary = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    binary[i] = Math.abs(gray[i] - blurred[i]) > threshold ? 1 : 0;
  }

  // Connected-component pass: keep only small, roughly spot-shaped blobs.
  // Big blobs are almost always real edges/objects/texture, not blemishes,
  // so they're left untouched on purpose.
  const minArea = 6;
  const maxArea = Math.max(150, Math.floor(w * h * 0.0025));
  const maxDiameter = Math.max(28, Math.floor(Math.min(w, h) * 0.06));

  const visited = new Uint8Array(w * h);
  const finalMask = new Uint8ClampedArray(w * h);
  let spotCount = 0;
  const stack = new Int32Array(w * h);

  for (let start = 0; start < w * h; start++) {
    if (!binary[start] || visited[start]) continue;

    let sp = 0;
    stack[sp++] = start;
    visited[start] = 1;
    const pixels = [];
    let minX = w, maxX = 0, minY = h, maxY = 0;

    while (sp > 0) {
      const p = stack[--sp];
      pixels.push(p);
      const x = p % w, y = (p / w) | 0;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;

      if (x > 0) { const j = p - 1; if (binary[j] && !visited[j]) { visited[j] = 1; stack[sp++] = j; } }
      if (x < w - 1) { const j = p + 1; if (binary[j] && !visited[j]) { visited[j] = 1; stack[sp++] = j; } }
      if (y > 0) { const j = p - w; if (binary[j] && !visited[j]) { visited[j] = 1; stack[sp++] = j; } }
      if (y < h - 1) { const j = p + w; if (binary[j] && !visited[j]) { visited[j] = 1; stack[sp++] = j; } }
    }

    const area = pixels.length;
    const bw = maxX - minX + 1, bh = maxY - minY + 1;
    if (area >= minArea && area <= maxArea && bw <= maxDiameter && bh <= maxDiameter) {
      for (const p of pixels) finalMask[p] = 255;
      spotCount++;
    }
  }

  return { mask: dilateMask(finalMask, w, h, 2), count: spotCount };
}

// Runs auto-detect + fill directly on an already-loaded canvas context.
// Returns the number of spots filled (0 = nothing found).
function autoCleanCanvas(ctx, w, h, sensitivityKey) {
  const imageData = ctx.getImageData(0, 0, w, h);
  const { mask, count } = autoDetectMask(imageData, w, h, sensitivityKey);
  if (!count) return 0;
  const result = runInpaint(imageData, mask, w, h);
  ctx.putImageData(result, 0, 0);
  return count;
}

// Runs auto-clean on one File (always from its pristine original, not any
// existing manual/auto override) and stores the result as a new override.
async function autoCleanOneFile(file, sensitivityKey) {
  const img = new Image();
  const url = URL.createObjectURL(file);
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = reject;
    img.src = url;
  });

  let w = img.naturalWidth || img.width;
  let h = img.naturalHeight || img.height;
  if (Math.max(w, h) > MAX_EDIT_DIMENSION) {
    const scale = MAX_EDIT_DIMENSION / Math.max(w, h);
    w = Math.round(w * scale);
    h = Math.round(h * scale);
  }

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, w, h);
  URL.revokeObjectURL(url);

  const count = autoCleanCanvas(ctx, w, h, sensitivityKey);
  if (!count) return { applied: false, count: 0 };

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  const prev = cleanupOverrides.get(file);
  if (prev) URL.revokeObjectURL(prev.url);
  const outUrl = URL.createObjectURL(blob);
  cleanupOverrides.set(file, { blob, url: outUrl, name: file.name, auto: true });
  return { applied: true, count };
}

// ---- per-cell "Auto clean" button --------------------------------------
async function runAutoCleanForFile(file, btnEl) {
  btnEl.disabled = true;
  const prevLabel = btnEl.textContent;
  btnEl.textContent = "Cleaning…";
  try {
    await autoCleanOneFile(file, autoSensitivity);
  } catch (err) {
    console.error("Auto-clean failed for", file.name, err);
  } finally {
    btnEl.disabled = false;
    btnEl.textContent = prevLabel;
    if (window.currentPhotoFiles) renderPhotoGrid(window.currentPhotoFiles);
  }
}

// ---- "Auto-clean all photos" ------------------------------------------
autocleanAllBtn.addEventListener("click", async () => {
  const files = window.currentPhotoFiles || [];
  if (!files.length) return;

  autocleanAllBtn.disabled = true;
  autocleanStatusEl.hidden = false;

  let cleanedCount = 0;
  let skippedCount = 0;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    autocleanStatusEl.textContent = `Auto-cleaning ${i + 1} / ${files.length}…`;

    if (cleanupOverrides.has(file)) {
      // Don't clobber a photo that's already been manually or auto cleaned.
      skippedCount++;
      continue;
    }
    try {
      const { applied } = await autoCleanOneFile(file, autoSensitivity);
      if (applied) cleanedCount++;
    } catch (err) {
      console.error("Auto-clean failed for", file.name, err);
    }
    await new Promise((r) => setTimeout(r, 0));
  }

  renderPhotoGrid(files);
  autocleanAllBtn.disabled = false;

  const parts = [`Cleaned ${cleanedCount} of ${files.length} photo${files.length === 1 ? "" : "s"}.`];
  if (skippedCount) parts.push(`Skipped ${skippedCount} already-cleaned photo${skippedCount === 1 ? "" : "s"}.`);
  autocleanStatusEl.textContent = parts.join(" ");
});

// ---- in-modal "Auto-clean" button --------------------------------------
autocleanBtn.addEventListener("click", () => {
  if (!currentFile) return;
  autocleanBtn.disabled = true;
  statusEl.textContent = "Scanning for small blemishes…";
  // let the status text paint before the heavy synchronous work
  requestAnimationFrame(() => {
    setTimeout(() => {
      const count = autoCleanCanvas(imgCtx, imgCanvas.width, imgCanvas.height, autoSensitivity);
      autocleanBtn.disabled = false;
      statusEl.textContent = count
        ? `Auto-clean filled ${count} small spot${count === 1 ? "" : "s"}. Brush over anything left, or save.`
        : "Auto-clean didn't find any small isolated spots to fill — try brushing manually instead.";
    }, 0);
  });
});

applyBtn.addEventListener("click", async () => {
  const w = imgCanvas.width, h = imgCanvas.height;
  const maskData = maskCtx.getImageData(0, 0, w, h);
  const maskAlpha = new Uint8ClampedArray(w * h);
  for (let i = 0, p = 0; i < maskData.data.length; i += 4, p++) {
    maskAlpha[p] = maskData.data[i + 3];
  }
  const hasMask = maskAlpha.some((v) => v > 10);
  if (!hasMask) {
    statusEl.textContent = "Brush over the object you want removed first.";
    return;
  }

  applyBtn.disabled = true;
  statusEl.textContent = "Filling marked area…";
  // let the status text paint before the heavy synchronous work
  await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

  const imageData = imgCtx.getImageData(0, 0, w, h);
  const result = runInpaint(imageData, maskAlpha, w, h);
  imgCtx.putImageData(result, 0, 0);
  clearMask();

  applyBtn.disabled = false;
  statusEl.textContent = "Done — check the result, brush over any leftovers, or save.";
});

saveBtn.addEventListener("click", async () => {
  if (!currentFile) return;
  statusEl.textContent = "Saving…";
  const blob = await new Promise((resolve) => imgCanvas.toBlob(resolve, "image/png"));

  const prev = cleanupOverrides.get(currentFile);
  if (prev) URL.revokeObjectURL(prev.url);

  const url = URL.createObjectURL(blob);
  cleanupOverrides.set(currentFile, { blob, url, name: currentFile.name });

  closeModal();
  if (window.currentPhotoFiles) renderPhotoGrid(window.currentPhotoFiles);
});
