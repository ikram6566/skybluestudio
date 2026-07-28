/* ------------------------------------------------------------------
   Contact Sheet — batch photo crop / brighten / watermark tool
   100% client-side. No uploads, no backend.
------------------------------------------------------------------- */

const OUT_PPI = 92;
const SETTINGS_KEY = "contact-sheet-settings-v1";

const FRAME_PRESETS = {
  marketplace: { w: 1024, h: 768 },
  "ig-square": { w: 1080, h: 1080 },
  "ig-portrait": { w: 1080, h: 1350 },
  flyer: { w: 1800, h: 1200 },
  // "custom" is read from the number inputs at run time
};

// Quality-flag heuristics — rough, not scientific. Tuned by eye, not
// validated against a labeled dataset. Treat flags as "worth a second
// look," not "definitely bad."
const DARK_LUMINANCE_THRESHOLD = 70;   // 0-255, mean luminance below this = flagged dark
const BLUR_VARIANCE_THRESHOLD = 120;   // discrete-Laplacian variance below this = flagged blurry
const QUALITY_SAMPLE_W = 160;
const QUALITY_SAMPLE_H = 120;

// ---- state ----------------------------------------------------------
let photoFiles = [];      // File[]
let logoImage = null;     // HTMLImageElement
let cropMode = "cover";   // "cover" | "contain" | "none"
let outputFormat = "jpeg";// "jpeg" | "png"
let framePreset = "marketplace";
let logoPosition = "center";
let qualityCheckOn = true;
let results = [];         // { name, blob, url, flags }

// Set only when photos were loaded via the File System Access directory
// picker (Chrome/Edge). When present, processed photos are written
// straight back into this folder instead of offering a .zip download.
let sourceDirHandle = null;
const supportsDirectSave = typeof window.showDirectoryPicker === "function";

// Remembers the picked folder's name (not its contents) so the
// Description Writer page can offer to parse property details out of it
// without re-asking for folder access.
const LAST_FOLDER_NAME_KEY = "contact-sheet-last-folder-name";
function rememberFolderName(name) {
  if (!name) return;
  try {
    localStorage.setItem(LAST_FOLDER_NAME_KEY, name);
  } catch (err) {
    console.warn("Couldn't remember folder name:", err);
  }
}

// ---- element refs -----------------------------------------------------
const $ = (id) => document.getElementById(id);

const dropzonePhotos = $("dropzone-photos");
const inputPhotos = $("input-photos");
const inputPhotosFiles = $("input-photos-files");
const btnPickFiles = $("btn-pick-files");
const photoCountEl = $("photo-count");
const saveModeNoteEl = $("save-mode-note");
const saveStatusEl = $("save-status");

const inputLogo = $("input-logo");
const logoPreviewWrap = $("logo-preview");
const logoPreviewImg = $("logo-preview-img");
const logoPreviewLabel = $("logo-preview-label");

const DEFAULT_LOGO_PATH = "assets/sky-blue-logo.png";
const DEFAULT_LOGO_LABEL = "Default: Sky Blue Real Estate logo";

const ctlBrightness = $("ctl-brightness");
const valBrightness = $("val-brightness");
const ctlOpacity = $("ctl-opacity");
const valOpacity = $("val-opacity");
const ctlLogoSize = $("ctl-logosize");
const valLogoSize = $("val-logosize");

const cropModeGroup = $("ctl-cropmode");
const formatGroup = $("ctl-format");
const frameSizeGroup = $("ctl-framesize");
const customSizeFields = $("custom-size-fields");
const ctlCustomW = $("ctl-custom-w");
const ctlCustomH = $("ctl-custom-h");
const logoPosGroup = $("ctl-logopos");
const qualityToggleGroup = $("ctl-qualitytoggle");
const valQualityCheck = $("val-qualitycheck");

const btnRun = $("btn-run");
const progressWrap = $("progress");
const progressFill = $("progress-fill");
const progressLabel = $("progress-label");
const btnDownload = $("btn-download");

const panelResults = $("panel-results");
const sheetEl = $("sheet");
const qualitySummaryEl = $("quality-summary");

// ---- helpers ----------------------------------------------------------
function updateRunEnabled() {
  btnRun.disabled = !(photoFiles.length > 0 && logoImage);
}

function isImageFile(file) {
  return /\.(jpe?g|png|webp)$/i.test(file.name);
}

function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => { resolve(img); };
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });
}

function currentFrameSize() {
  if (framePreset === "custom") {
    const w = Math.max(100, Number(ctlCustomW.value) || 1024);
    const h = Math.max(100, Number(ctlCustomH.value) || 768);
    return { w, h };
  }
  return FRAME_PRESETS[framePreset] || FRAME_PRESETS.marketplace;
}

// ---- settings persistence (localStorage) ---------------------------------
// Only UI settings are saved — never the actual photo files or a custom
// logo file, since those aren't practical (or private-by-default) to put
// in localStorage. The bundled default logo re-loads fresh each visit.
function saveSettings() {
  const data = {
    brightness: ctlBrightness.value,
    opacity: ctlOpacity.value,
    logoSize: ctlLogoSize.value,
    cropMode,
    format: outputFormat,
    framePreset,
    customW: ctlCustomW.value,
    customH: ctlCustomH.value,
    logoPosition,
    qualityCheckOn,
  };
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(data));
  } catch (err) {
    // localStorage can throw in private-browsing modes — non-fatal
    console.warn("Couldn't save settings:", err);
  }
}

function applySettings(data) {
  if (!data) return;
  if (data.brightness) { ctlBrightness.value = data.brightness; valBrightness.textContent = `${data.brightness}%`; }
  if (data.opacity) { ctlOpacity.value = data.opacity; valOpacity.textContent = `${data.opacity}%`; }
  if (data.logoSize) { ctlLogoSize.value = data.logoSize; valLogoSize.textContent = `${data.logoSize}%`; }
  if (data.cropMode) { setActiveSegment(cropModeGroup, "mode", data.cropMode); cropMode = data.cropMode; cropModeNote.textContent = CROP_NOTES[cropMode]; }
  if (data.format) { setActiveSegment(formatGroup, "format", data.format); outputFormat = data.format; }
  if (data.framePreset) { setActiveSegment(frameSizeGroup, "preset", data.framePreset); framePreset = data.framePreset; customSizeFields.hidden = framePreset !== "custom"; }
  if (data.customW) ctlCustomW.value = data.customW;
  if (data.customH) ctlCustomH.value = data.customH;
  if (data.logoPosition) { setActiveSegment(logoPosGroup, "pos", data.logoPosition); logoPosition = data.logoPosition; }
  if (typeof data.qualityCheckOn === "boolean") {
    qualityCheckOn = data.qualityCheckOn;
    setActiveSegment(qualityToggleGroup, "check", qualityCheckOn ? "on" : "off");
    valQualityCheck.textContent = qualityCheckOn ? "On" : "Off";
  }
}

function setActiveSegment(group, dataAttr, value) {
  [...group.children].forEach((c) => c.classList.toggle("is-active", c.dataset[dataAttr] === value));
}

function loadSavedSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) applySettings(JSON.parse(raw));
  } catch (err) {
    console.warn("Couldn't load saved settings:", err);
  }
}

// ---- photo input --------------------------------------------------------

// Primary path: the File System Access directory picker (Chrome/Edge/
// Opera). Reading this way also grants write access, so processed photos
// can be saved straight back into the same folder — no zip, no download.
dropzonePhotos.addEventListener("click", () => pickPhotoFolder());
dropzonePhotos.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    pickPhotoFolder();
  }
});

async function pickPhotoFolder() {
  if (supportsDirectSave) {
    try {
      const handle = await window.showDirectoryPicker({ mode: "readwrite" });
      await loadFromDirectoryHandle(handle);
      return;
    } catch (err) {
      if (err && err.name === "AbortError") return; // user closed the picker
      console.warn("Directory picker failed, falling back to the classic file input:", err);
    }
  }
  // Fallback for browsers without the API (Firefox, Safari) — read-only,
  // results come back as a .zip to download instead.
  sourceDirHandle = null;
  inputPhotos.click();
}

async function loadFromDirectoryHandle(handle) {
  const files = [];
  for await (const [name, entryHandle] of handle.entries()) {
    if (entryHandle.kind === "file" && isImageFile({ name })) {
      files.push(await entryHandle.getFile());
    }
  }
  sourceDirHandle = handle;
  photoFiles = files;
  window.currentPhotoFiles = photoFiles;
  rememberFolderName(handle.name);
  refreshPhotoCount();
  if (window.renderPhotoGrid) window.renderPhotoGrid(photoFiles);
}

// Fallback read-only folder input (webkitdirectory) — no write access.
inputPhotos.addEventListener("change", (e) => {
  sourceDirHandle = null;
  const files = Array.from(e.target.files || []).filter(isImageFile);
  photoFiles = files;
  window.currentPhotoFiles = photoFiles;
  const firstPath = files[0] && files[0].webkitRelativePath;
  if (firstPath) rememberFolderName(firstPath.split("/")[0]);
  refreshPhotoCount();
  if (window.renderPhotoGrid) window.renderPhotoGrid(photoFiles);
});

btnPickFiles.addEventListener("click", () => inputPhotosFiles.click());
inputPhotosFiles.addEventListener("change", (e) => {
  sourceDirHandle = null;
  const files = Array.from(e.target.files || []).filter(isImageFile);
  photoFiles = files;
  window.currentPhotoFiles = photoFiles;
  refreshPhotoCount();
  if (window.renderPhotoGrid) window.renderPhotoGrid(photoFiles);
});

function updateSaveModeNote() {
  if (!saveModeNoteEl) return;
  if (sourceDirHandle) {
    saveModeNoteEl.textContent =
      "Direct-save is on: processed photos will be written straight into this folder as edited1, edited2, … — no download needed.";
  } else if (supportsDirectSave) {
    saveModeNoteEl.textContent =
      "Use \"Choose folder\" (not individual files) to save results straight back into it. Individual files still work, but you'll get a .zip to download.";
  } else {
    saveModeNoteEl.textContent =
      "This browser doesn't support saving straight back to a folder — you'll get a .zip download instead.";
  }
}

function refreshPhotoCount() {
  if (photoFiles.length === 0) {
    photoCountEl.textContent = "No photos loaded yet.";
    photoCountEl.classList.add("is-empty");
  } else {
    photoCountEl.textContent = `${photoFiles.length} photo${photoFiles.length === 1 ? "" : "s"} loaded.`;
    photoCountEl.classList.remove("is-empty");
  }
  updateSaveModeNote();
  updateRunEnabled();
}

// ---- logo input --------------------------------------------------------
inputLogo.addEventListener("change", async (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  try {
    logoImage = await loadImageFromFile(file);
    logoPreviewImg.src = logoImage.src;
    logoPreviewLabel.textContent = file.name;
  } catch (err) {
    alert("Couldn't read that logo file.");
  }
  updateRunEnabled();
});

// Load the bundled default logo automatically so the page is usable
// without any manual upload. Users can still override it any time via
// the file picker above.
async function loadDefaultLogo() {
  try {
    const res = await fetch(DEFAULT_LOGO_PATH);
    if (!res.ok) throw new Error(`${res.status}`);
    const blob = await res.blob();
    const img = new Image();
    const url = URL.createObjectURL(blob);
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = url;
    });
    logoImage = img;
    logoPreviewImg.src = url;
    logoPreviewLabel.textContent = DEFAULT_LOGO_LABEL;
  } catch (err) {
    logoPreviewWrap.hidden = true;
    console.warn("Default logo not loaded:", err);
  }
  updateRunEnabled();
}

// ---- sliders -------------------------------------------------------------
ctlBrightness.addEventListener("input", () => {
  valBrightness.textContent = `${ctlBrightness.value}%`;
  saveSettings();
});
ctlOpacity.addEventListener("input", () => {
  valOpacity.textContent = `${ctlOpacity.value}%`;
  saveSettings();
});
ctlLogoSize.addEventListener("input", () => {
  valLogoSize.textContent = `${ctlLogoSize.value}%`;
  saveSettings();
});

// ---- segmented controls ---------------------------------------------------
const cropModeNote = $("cropmode-note");
const CROP_NOTES = {
  cover: "Edges outside the frame's ratio get trimmed to fill it exactly.",
  contain: "Whole photo stays visible, white bars fill the rest of the frame.",
  none: "Each photo keeps its original width/height — nothing is cropped or resized. Frame size above is ignored.",
};

cropModeGroup.addEventListener("click", (e) => {
  const btn = e.target.closest(".segmented__opt");
  if (!btn) return;
  cropMode = btn.dataset.mode;
  setActiveSegment(cropModeGroup, "mode", cropMode);
  cropModeNote.textContent = CROP_NOTES[cropMode];
  saveSettings();
});

formatGroup.addEventListener("click", (e) => {
  const btn = e.target.closest(".segmented__opt");
  if (!btn) return;
  outputFormat = btn.dataset.format;
  setActiveSegment(formatGroup, "format", outputFormat);
  saveSettings();
});

frameSizeGroup.addEventListener("click", (e) => {
  const btn = e.target.closest(".segmented__opt");
  if (!btn) return;
  framePreset = btn.dataset.preset;
  setActiveSegment(frameSizeGroup, "preset", framePreset);
  customSizeFields.hidden = framePreset !== "custom";
  saveSettings();
});
ctlCustomW.addEventListener("input", saveSettings);
ctlCustomH.addEventListener("input", saveSettings);

logoPosGroup.addEventListener("click", (e) => {
  const btn = e.target.closest(".segmented__opt");
  if (!btn) return;
  logoPosition = btn.dataset.pos;
  setActiveSegment(logoPosGroup, "pos", logoPosition);
  saveSettings();
});

qualityToggleGroup.addEventListener("click", (e) => {
  const btn = e.target.closest(".segmented__opt");
  if (!btn) return;
  qualityCheckOn = btn.dataset.check === "on";
  setActiveSegment(qualityToggleGroup, "check", btn.dataset.check);
  valQualityCheck.textContent = qualityCheckOn ? "On" : "Off";
  saveSettings();
});

// ---- logo position math ---------------------------------------------------
// Returns top-left (x, y) for the logo given the frame size and a margin
// as a fraction of the shorter frame dimension, so margins look
// consistent whether the frame is wide, tall, or square.
function computeLogoPosition(position, outW, outH, logoW, logoH) {
  const margin = Math.round(Math.min(outW, outH) * 0.04);
  switch (position) {
    case "top-left":
      return { x: margin, y: margin };
    case "top-right":
      return { x: outW - logoW - margin, y: margin };
    case "bottom-left":
      return { x: margin, y: outH - logoH - margin };
    case "bottom-right":
      return { x: outW - logoW - margin, y: outH - logoH - margin };
    case "bottom-center":
      return { x: (outW - logoW) / 2, y: outH - logoH - margin };
    case "center":
    default:
      return { x: (outW - logoW) / 2, y: (outH - logoH) / 2 };
  }
}

// ---- quality heuristics ----------------------------------------------------
// Cheap, approximate checks run on a downscaled copy of the ORIGINAL photo
// (before any brightness/logo edits) so the flag reflects source quality,
// not what this tool did to it. This is a heuristic, not a real computer-
// vision quality model — false positives/negatives are expected, treat it
// as a nudge to look closer, not a verdict.
function analyzeQuality(img) {
  const canvas = document.createElement("canvas");
  canvas.width = QUALITY_SAMPLE_W;
  canvas.height = QUALITY_SAMPLE_H;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, QUALITY_SAMPLE_W, QUALITY_SAMPLE_H);

  const { data } = ctx.getImageData(0, 0, QUALITY_SAMPLE_W, QUALITY_SAMPLE_H);
  const w = QUALITY_SAMPLE_W, h = QUALITY_SAMPLE_H;
  const gray = new Float32Array(w * h);

  let sum = 0;
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    gray[p] = lum;
    sum += lum;
  }
  const avgBrightness = sum / gray.length;

  // discrete Laplacian variance as a cheap sharpness proxy
  let lapSum = 0, lapSumSq = 0, count = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = y * w + x;
      const lap =
        4 * gray[idx] - gray[idx - 1] - gray[idx + 1] - gray[idx - w] - gray[idx + w];
      lapSum += lap;
      lapSumSq += lap * lap;
      count++;
    }
  }
  const lapMean = lapSum / count;
  const blurVariance = lapSumSq / count - lapMean * lapMean;

  return {
    isDark: avgBrightness < DARK_LUMINANCE_THRESHOLD,
    isBlurry: blurVariance < BLUR_VARIANCE_THRESHOLD,
    avgBrightness: Math.round(avgBrightness),
    blurVariance: Math.round(blurVariance),
  };
}

// ---- core processing -------------------------------------------------------
function drawCropped(ctx, img, mode, outW, outH) {
  const srcW = img.naturalWidth || img.width;
  const srcH = img.naturalHeight || img.height;
  const targetRatio = outW / outH;
  const srcRatio = srcW / srcH;

  if (mode === "cover") {
    let sx, sy, sw, sh;
    if (srcRatio > targetRatio) {
      sh = srcH;
      sw = srcH * targetRatio;
      sx = (srcW - sw) / 2;
      sy = 0;
    } else {
      sw = srcW;
      sh = srcW / targetRatio;
      sx = 0;
      sy = (srcH - sh) / 2;
    }
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, outW, outH);
  } else {
    // contain: fit whole image inside, letterbox with white background
    ctx.save();
    ctx.filter = "none";
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, outW, outH);
    ctx.restore();

    let dw, dh;
    if (srcRatio > targetRatio) {
      dw = outW;
      dh = outW / srcRatio;
    } else {
      dh = outH;
      dw = outH * srcRatio;
    }
    const dx = (outW - dw) / 2;
    const dy = (outH - dh) / 2;
    ctx.drawImage(img, 0, 0, srcW, srcH, dx, dy, dw, dh);
  }
}

async function processOneFile(file, settings, index) {
  // If the user ran the clean-up tool (manual or auto) and saved a result
  // for this photo, use that as the source pixels.
  const override = typeof cleanupOverrides !== "undefined" ? cleanupOverrides.get(file) : null;
  const img = await loadImageFromFile(override ? override.blob : file);

  const flags = settings.qualityCheckOn ? analyzeQuality(img) : null;

  const srcW = img.naturalWidth || img.width;
  const srcH = img.naturalHeight || img.height;

  const canvas = document.createElement("canvas");
  if (settings.cropMode === "none") {
    canvas.width = srcW;
    canvas.height = srcH;
  } else {
    canvas.width = settings.frameW;
    canvas.height = settings.frameH;
  }
  const ctx = canvas.getContext("2d");
  const outW = canvas.width;
  const outH = canvas.height;

  // 1. draw the photo (cropped/letterboxed/untouched depending on mode),
  //    with brightness filter applied on the draw
  ctx.filter = `brightness(${settings.brightness}%)`;
  if (settings.cropMode === "none") {
    ctx.drawImage(img, 0, 0, srcW, srcH, 0, 0, outW, outH);
  } else {
    drawCropped(ctx, img, settings.cropMode, outW, outH);
  }
  ctx.filter = "none";

  // 2. watermark, positioned per settings, at chosen opacity — sized
  //    relative to this photo's own output width
  if (logoImage) {
    const lw0 = logoImage.naturalWidth || logoImage.width;
    const lh0 = logoImage.naturalHeight || logoImage.height;
    const targetW = outW * (settings.logoSize / 100);
    const targetH = targetW * (lh0 / lw0);
    const { x: lx, y: ly } = computeLogoPosition(settings.logoPosition, outW, outH, targetW, targetH);

    ctx.save();
    ctx.globalAlpha = settings.opacity / 100;
    ctx.drawImage(logoImage, lx, ly, targetW, targetH);
    ctx.restore();
  }

  URL.revokeObjectURL(img.src);

  // 3. export
  const mime = settings.format === "png" ? "image/png" : "image/jpeg";
  const quality = settings.format === "png" ? undefined : 0.92;

  const blob = await new Promise((resolve) =>
    canvas.toBlob(resolve, mime, quality)
  );

  const finalBlob =
    settings.format === "jpeg" ? stampJpegDpi(await blob.arrayBuffer(), OUT_PPI) : blob;

  const outName = renameForOutput(index, settings.format);
  return { name: outName, blob: finalBlob, flags };
}

function renameForOutput(index, format) {
  const ext = format === "png" ? "png" : "jpg";
  return `edited${index + 1}.${ext}`;
}

// Patch a JPEG's JFIF APP0 segment so it reports OUT_PPI as the pixel
// density. This is metadata only — it does not change the pixel grid,
// and most web contexts (browsers, Vercel, <img> tags) ignore it entirely.
// It only becomes visible if someone opens the file in an app like
// Photoshop that reads the density field (e.g. Image > Image Size).
function stampJpegDpi(arrayBuffer, dpi) {
  const bytes = new Uint8Array(arrayBuffer);
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff && bytes[3] === 0xe0) {
    if (
      bytes[6] === 0x4a && bytes[7] === 0x46 && bytes[8] === 0x49 &&
      bytes[9] === 0x46 && bytes[10] === 0x00
    ) {
      bytes[13] = 1; // units = 1 -> dots per inch
      bytes[14] = (dpi >> 8) & 0xff;
      bytes[15] = dpi & 0xff;
      bytes[16] = (dpi >> 8) & 0xff;
      bytes[17] = dpi & 0xff;
    }
  }
  return new Blob([bytes], { type: "image/jpeg" });
}

// ---- run ---------------------------------------------------------------
btnRun.addEventListener("click", async () => {
  if (!photoFiles.length || !logoImage) return;

  const { w: frameW, h: frameH } = currentFrameSize();

  const settings = {
    brightness: Number(ctlBrightness.value),
    opacity: Number(ctlOpacity.value),
    logoSize: Number(ctlLogoSize.value),
    cropMode,
    format: outputFormat,
    frameW,
    frameH,
    logoPosition,
    qualityCheckOn,
  };

  results.forEach((r) => URL.revokeObjectURL(r.url));
  results = [];
  sheetEl.innerHTML = "";
  panelResults.hidden = true;
  btnDownload.hidden = true;
  saveStatusEl.hidden = true;
  qualitySummaryEl.hidden = true;

  btnRun.disabled = true;
  progressWrap.hidden = false;

  let flaggedCount = 0;

  for (let i = 0; i < photoFiles.length; i++) {
    progressLabel.textContent = `${i + 1} / ${photoFiles.length}`;
    progressFill.style.width = `${((i) / photoFiles.length) * 100}%`;

    try {
      const { name, blob, flags } = await processOneFile(photoFiles[i], settings, i);
      const url = URL.createObjectURL(blob);
      results.push({ name, blob, url, flags });
      if (flags && (flags.isDark || flags.isBlurry)) flaggedCount++;
      appendFrame(name, url, flags);
    } catch (err) {
      console.error("Failed on", photoFiles[i].name, err);
    }

    await new Promise((r) => setTimeout(r, 0));
  }

  progressFill.style.width = "100%";
  progressWrap.hidden = true;
  btnRun.disabled = false;
  panelResults.hidden = results.length === 0;

  if (results.length && sourceDirHandle) {
    try {
      await saveResultsToDirectory(results, sourceDirHandle);
      saveStatusEl.hidden = false;
      saveStatusEl.textContent = `Saved ${results.length} photo${results.length === 1 ? "" : "s"} straight into the picked folder as edited1–edited${results.length} (any files with those names from a previous run were overwritten).`;
    } catch (err) {
      console.error("Direct save to folder failed, offering a .zip instead:", err);
      btnDownload.hidden = false;
    }
  } else {
    btnDownload.hidden = results.length === 0;
  }

  if (settings.qualityCheckOn && flaggedCount > 0) {
    qualitySummaryEl.hidden = false;
    qualitySummaryEl.textContent = `${flaggedCount} of ${results.length} photo${results.length === 1 ? "" : "s"} flagged as possibly dark or blurry — check the badges below before posting.`;
  }
});

// Writes each result blob directly into the picked folder using the
// File System Access API — this is what lets the tool skip the .zip
// download entirely when a folder (not individual files) was chosen.
async function saveResultsToDirectory(results, dirHandle) {
  for (const r of results) {
    const fileHandle = await dirHandle.getFileHandle(r.name, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(r.blob);
    await writable.close();
  }
}

function appendFrame(name, url, flags) {
  const div = document.createElement("div");
  div.className = "frame";

  let badges = "";
  if (flags && (flags.isDark || flags.isBlurry)) {
    const parts = [];
    if (flags.isDark) parts.push('<span class="frame__badge">DARK</span>');
    if (flags.isBlurry) parts.push('<span class="frame__badge">BLURRY</span>');
    badges = `<div class="frame__badges">${parts.join("")}</div>`;
  }

  div.innerHTML = `<img src="${url}" alt="${name}" />${badges}<span class="frame__tag">${name}</span>`;
  sheetEl.appendChild(div);
}

// ---- zip download --------------------------------------------------------
btnDownload.addEventListener("click", async () => {
  if (!results.length) return;
  btnDownload.disabled = true;
  btnDownload.textContent = "Zipping…";

  const zip = new JSZip();
  results.forEach((r) => zip.file(r.name, r.blob));
  const content = await zip.generateAsync({ type: "blob" });

  const a = document.createElement("a");
  a.href = URL.createObjectURL(content);
  a.download = "processed-photos.zip";
  document.body.appendChild(a);
  a.click();
  a.remove();

  btnDownload.disabled = false;
  btnDownload.textContent = "Download all as .zip";
});

// ---- init -----------------------------------------------------------------
loadSavedSettings();
loadDefaultLogo();
customSizeFields.hidden = framePreset !== "custom";
updateSaveModeNote();
