/* ═══════════════════════════════════════════════
   SNAPCRAFT — app.js
   ═══════════════════════════════════════════════ */

"use strict";

// ──────────────────────────────────────────────────
// CONSTANTS
// ──────────────────────────────────────────────────

const APP_VERSION = "0.1.0";

const CREATION_TYPES = {
  album:           { label: "Album photo",      icon: "🗂️" },
  livre:           { label: "Livre",             icon: "📖" },
  "carte-souvenir":{ label: "Carte souvenir",   icon: "🪪" },
  "carte-envoi":   { label: "Carte à envoyer",  icon: "✉️" },
  "carte-jeu":     { label: "Carte de jeu",     icon: "🃏" },
  "carte-mission": { label: "Carte mission",    icon: "🎯" },
};

const STICKERS = [
  "😀","😍","🥳","😎","🤩","😂","❤️","🔥","✨","🌟",
  "🎉","🎊","🌈","🌸","🌊","🏔️","🌙","⭐","🦋","🍀",
  "📸","🎨","🎵","🌺","🍕","🎯","🏆","💫","🌴","🦄",
];

const CSS_FILTERS = {
  none:  "none",
  bw:    "grayscale(100%)",
  sepia: "sepia(80%)",
  warm:  "sepia(30%) saturate(140%) hue-rotate(-10deg)",
  cool:  "hue-rotate(30deg) saturate(90%)",
  vivid: "saturate(160%) contrast(110%)",
};

const STORY_CATEGORIES = [
  { id: "voyage", label: "Voyage" },
  { id: "famille", label: "Famille" },
  { id: "amis", label: "Amis" },
  { id: "mission", label: "Mission" },
  { id: "souvenir", label: "Souvenir" },
  { id: "libre", label: "Libre" },
];

// ──────────────────────────────────────────────────
// STATE
// ──────────────────────────────────────────────────

const STATE = {
  // All creations stored locally
  creations: [],          // [{ id, type, title, createdAt, pages, design }]
  
  // Currently open creation
  activeCreationId: null,
  activePageIndex: null,

  // UI
  homeTypeFilter: "all",
  activeTool: "select",
  activeFilter: "none",
  selectedAnnotationId: null,
  bookPageIndexByCreation: {},
  bookAnimating: false,
  bookAnimateDirection: null,
  photoScaleByCreation: {},
  builder: {
    uiScale: 100,
    contentWidth: 420,
    homeCols: 2,
    photoHeight: 154,
    density: 100,
    radius: 12,
  },
  storyPlayer: {
    timerId: null,
    creationId: null,
    category: "all",
    index: 0,
  },

  // Settings
  storageMode: "local",   // "local" | "cloud"
  supabaseUrl: "",
  supabaseKey: "",
};

// ──────────────────────────────────────────────────
// STORAGE
// ──────────────────────────────────────────────────

function loadState() {
  try {
    const raw = localStorage.getItem("snapcraft_state");
    if (raw) {
      const saved = JSON.parse(raw);
      STATE.creations    = saved.creations    ?? [];
      STATE.storageMode  = saved.storageMode  ?? "local";
      STATE.supabaseUrl  = saved.supabaseUrl  ?? "";
      STATE.supabaseKey  = saved.supabaseKey  ?? "";
      STATE.photoScaleByCreation = saved.photoScaleByCreation ?? {};
      const b = saved.builder ?? {};
      STATE.builder.uiScale = Number(b.uiScale) || 100;
      STATE.builder.contentWidth = Number(b.contentWidth) || 420;
      STATE.builder.homeCols = Number(b.homeCols) || 2;
      STATE.builder.photoHeight = Number(b.photoHeight) || 154;
      STATE.builder.density = Number(b.density) || 100;
      STATE.builder.radius = Number(b.radius) || 12;
    }
  } catch (e) {
    console.warn("Failed to load state:", e);
  }
}

function saveState() {
  try {
    localStorage.setItem("snapcraft_state", JSON.stringify({
      creations:   STATE.creations,
      storageMode: STATE.storageMode,
      supabaseUrl: STATE.supabaseUrl,
      supabaseKey: STATE.supabaseKey,
      photoScaleByCreation: STATE.photoScaleByCreation,
      builder: STATE.builder,
    }));
  } catch (e) {
    console.warn("Failed to save state:", e);
  }
}

// ──────────────────────────────────────────────────
// UTILITIES
// ──────────────────────────────────────────────────

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function formatDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
}

function parseExifDateString(value) {
  if (!value || typeof value !== "string") return null;
  const m = value.trim().match(/^(\d{4}):(\d{2}):(\d{2})\s+(\d{2}):(\d{2}):(\d{2})$/);
  if (!m) return null;

  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const h = Number(m[4]);
  const mi = Number(m[5]);
  const s = Number(m[6]);
  if (![y, mo, d, h, mi, s].every(Number.isFinite)) return null;

  return new Date(Date.UTC(y, mo - 1, d, h, mi, s)).toISOString();
}

function readExifAsciiTag(view, tiffStart, ifdOffsetAbs, littleEndian, tagWanted) {
  if (ifdOffsetAbs + 2 > view.byteLength) return null;
  const entries = view.getUint16(ifdOffsetAbs, littleEndian);

  for (let i = 0; i < entries; i += 1) {
    const entry = ifdOffsetAbs + 2 + i * 12;
    if (entry + 12 > view.byteLength) return null;

    const tag = view.getUint16(entry, littleEndian);
    const type = view.getUint16(entry + 2, littleEndian);
    const count = view.getUint32(entry + 4, littleEndian);
    const valueOrOffset = view.getUint32(entry + 8, littleEndian);

    if (tag !== tagWanted || type !== 2 || count < 2) continue;

    const strOffset = count <= 4 ? entry + 8 : tiffStart + valueOrOffset;
    if (strOffset + count > view.byteLength) return null;

    let out = "";
    for (let c = 0; c < count; c += 1) {
      const code = view.getUint8(strOffset + c);
      if (code === 0) break;
      out += String.fromCharCode(code);
    }
    return out || null;
  }

  return null;
}

function readExifPointer(view, ifdOffsetAbs, littleEndian) {
  if (ifdOffsetAbs + 2 > view.byteLength) return null;
  const entries = view.getUint16(ifdOffsetAbs, littleEndian);

  for (let i = 0; i < entries; i += 1) {
    const entry = ifdOffsetAbs + 2 + i * 12;
    if (entry + 12 > view.byteLength) return null;
    const tag = view.getUint16(entry, littleEndian);
    if (tag === 0x8769) return view.getUint32(entry + 8, littleEndian);
  }

  return null;
}

function extractJpegExifDate(buffer) {
  const view = new DataView(buffer);
  if (view.byteLength < 4) return null;
  if (view.getUint16(0, false) !== 0xFFD8) return null;

  let offset = 2;
  while (offset + 4 < view.byteLength) {
    if (view.getUint8(offset) !== 0xFF) break;
    const marker = view.getUint8(offset + 1);
    if (marker === 0xDA || marker === 0xD9) break;

    const segmentLength = view.getUint16(offset + 2, false);
    if (segmentLength < 2 || offset + 2 + segmentLength > view.byteLength) break;

    if (marker === 0xE1) {
      const exifStart = offset + 4;
      const isExif =
        exifStart + 6 <= view.byteLength &&
        view.getUint8(exifStart) === 0x45 &&
        view.getUint8(exifStart + 1) === 0x78 &&
        view.getUint8(exifStart + 2) === 0x69 &&
        view.getUint8(exifStart + 3) === 0x66 &&
        view.getUint8(exifStart + 4) === 0x00 &&
        view.getUint8(exifStart + 5) === 0x00;

      if (isExif) {
        const tiffStart = exifStart + 6;
        if (tiffStart + 8 > view.byteLength) return null;

        const byteOrder = view.getUint16(tiffStart, false);
        const littleEndian = byteOrder === 0x4949;
        if (!littleEndian && byteOrder !== 0x4D4D) return null;
        if (view.getUint16(tiffStart + 2, littleEndian) !== 42) return null;

        const ifd0Rel = view.getUint32(tiffStart + 4, littleEndian);
        const ifd0Abs = tiffStart + ifd0Rel;

        let raw = readExifAsciiTag(view, tiffStart, ifd0Abs, littleEndian, 0x9003);
        if (!raw) raw = readExifAsciiTag(view, tiffStart, ifd0Abs, littleEndian, 0x0132);

        const exifPtr = readExifPointer(view, ifd0Abs, littleEndian);
        if (!raw && Number.isFinite(exifPtr)) {
          raw = readExifAsciiTag(view, tiffStart, tiffStart + exifPtr, littleEndian, 0x9003);
        }

        return parseExifDateString(raw);
      }
    }

    offset += 2 + segmentLength;
  }

  return null;
}

async function extractPhotoTakenDate(file) {
  try {
    const isJpeg = /jpe?g/i.test(file.type || "") || /\.jpe?g$/i.test(file.name || "");
    if (isJpeg) {
      const iso = extractJpegExifDate(await file.arrayBuffer());
      if (iso) return iso;
    }
  } catch (e) {
    console.warn("EXIF parse failed:", e);
  }

  if (Number.isFinite(file.lastModified) && file.lastModified > 0) {
    return new Date(file.lastModified).toISOString();
  }

  return new Date().toISOString();
}

function showToast(msg, duration = 2000) {
  const toast = document.getElementById("toast");
  toast.textContent = msg;
  toast.classList.remove("hidden");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toast.classList.add("hidden"), duration);
}

function getCategoryLabel(categoryId) {
  const found = STORY_CATEGORIES.find(c => c.id === categoryId);
  return found ? found.label : "Libre";
}

function ensurePageCategory(page) {
  if (!page.category) page.category = "souvenir";
}

function stopStoryPlayback() {
  if (STATE.storyPlayer.timerId) {
    clearInterval(STATE.storyPlayer.timerId);
    STATE.storyPlayer.timerId = null;
  }
}

function getPhotoScaleForCreation(creationId) {
  const raw = STATE.photoScaleByCreation[creationId];
  const numeric = Number(raw);
  if (Number.isFinite(numeric) && numeric >= 45 && numeric <= 120) return numeric;
  return 70;
}

function applyPhotoScaleToUi(creationId) {
  const scroll = document.getElementById("album-scroll");
  const range = document.getElementById("album-size-range");
  const value = document.getElementById("album-size-value");
  if (!scroll || !range || !value) return;

  const scale = getPhotoScaleForCreation(creationId);
  const px = Math.round(220 * (scale / 100));
  scroll.style.setProperty("--album-photo-max-h", `${px}px`);
  range.value = String(scale);
  value.textContent = `${scale}%`;
}

function getDefaultPhotoHeightPx(creationId) {
  const scale = getPhotoScaleForCreation(creationId);
  return Math.round(STATE.builder.photoHeight * (scale / 100));
}

function applyBuilderCssVars() {
  const root = document.documentElement;
  root.style.setProperty("--builder-ui-scale", String(STATE.builder.uiScale / 100));
  root.style.setProperty("--builder-content-max", `${STATE.builder.contentWidth}px`);
  root.style.setProperty("--builder-home-cols", String(Math.max(1, Math.min(3, STATE.builder.homeCols))));
  root.style.setProperty("--builder-photo-max-h", `${STATE.builder.photoHeight}px`);
  root.style.setProperty("--builder-density", String(STATE.builder.density / 100));
  root.style.setProperty("--builder-radius", `${STATE.builder.radius}px`);
  root.style.setProperty("--radius", `${STATE.builder.radius}px`);
}

function syncBuilderPanelUi() {
  const ui = document.getElementById("builder-ui-scale");
  const width = document.getElementById("builder-content-width");
  const photo = document.getElementById("builder-photo-height");
  const homeCols = document.getElementById("builder-home-cols");
  const density = document.getElementById("builder-density");
  const radius = document.getElementById("builder-radius");
  const uiV = document.getElementById("builder-ui-scale-value");
  const widthV = document.getElementById("builder-content-width-value");
  const photoV = document.getElementById("builder-photo-height-value");
  const homeColsV = document.getElementById("builder-home-cols-value");
  const densityV = document.getElementById("builder-density-value");
  const radiusV = document.getElementById("builder-radius-value");

  if (!ui || !width || !photo || !homeCols || !density || !radius) return;

  ui.value = String(STATE.builder.uiScale);
  width.value = String(STATE.builder.contentWidth);
  homeCols.value = String(STATE.builder.homeCols);
  photo.value = String(STATE.builder.photoHeight);
  density.value = String(STATE.builder.density);
  radius.value = String(STATE.builder.radius);
  uiV.textContent = `${STATE.builder.uiScale}%`;
  widthV.textContent = `${STATE.builder.contentWidth}px`;
  homeColsV.textContent = `${STATE.builder.homeCols}`;
  photoV.textContent = `${STATE.builder.photoHeight}px`;
  densityV.textContent = `${STATE.builder.density}%`;
  radiusV.textContent = `${STATE.builder.radius}px`;
}

function initBuilderControls() {
  const panel = document.getElementById("builder-panel");
  const toggle = document.getElementById("builder-toggle");
  const close = document.getElementById("builder-close");
  const reset = document.getElementById("builder-reset");
  const ui = document.getElementById("builder-ui-scale");
  const width = document.getElementById("builder-content-width");
  const photo = document.getElementById("builder-photo-height");
  const homeCols = document.getElementById("builder-home-cols");
  const density = document.getElementById("builder-density");
  const radius = document.getElementById("builder-radius");

  if (!panel || !toggle || !close || !reset) return;

  const update = () => {
    STATE.builder.uiScale = Number(ui.value);
    STATE.builder.contentWidth = Number(width.value);
    STATE.builder.homeCols = Number(homeCols.value);
    STATE.builder.photoHeight = Number(photo.value);
    STATE.builder.density = Number(density.value);
    STATE.builder.radius = Number(radius.value);
    applyBuilderCssVars();
    syncBuilderPanelUi();
    saveState();

    const creation = STATE.creations.find(c => c.id === STATE.activeCreationId);
    if (creation) renderAlbum(creation);
  };

  toggle.addEventListener("click", () => panel.classList.toggle("hidden"));
  close.addEventListener("click", () => panel.classList.add("hidden"));
  reset.addEventListener("click", () => {
    STATE.builder = { uiScale: 100, contentWidth: 420, homeCols: 2, photoHeight: 154, density: 100, radius: 12 };
    applyBuilderCssVars();
    syncBuilderPanelUi();
    saveState();
    const creation = STATE.creations.find(c => c.id === STATE.activeCreationId);
    if (creation) renderAlbum(creation);
  });

  [ui, width, homeCols, photo, density, radius].forEach(ctrl => {
    ctrl.addEventListener("input", update);
  });

  applyBuilderCssVars();
  syncBuilderPanelUi();
}

function applyPhotoHeight(photoWrap, page, creationId) {
  const h = Number(page.photoHeightPx);
  if (Number.isFinite(h) && h >= 90 && h <= 420) {
    photoWrap.style.height = `${h}px`;
    photoWrap.style.maxHeight = `${h}px`;
  } else {
    const fallback = getDefaultPhotoHeightPx(creationId);
    photoWrap.style.height = "";
    photoWrap.style.maxHeight = `${fallback}px`;
  }

  const w = Number(page.photoWidthPct);
  const widthPct = Number.isFinite(w) ? Math.max(35, Math.min(100, w)) : 100;
  const maxOffset = 100 - widthPct;
  const oxRaw = Number(page.photoOffsetXPct);
  const offset = Number.isFinite(oxRaw) ? Math.max(0, Math.min(maxOffset, oxRaw)) : 0;

  page.photoWidthPct = widthPct;
  page.photoOffsetXPct = offset;
  photoWrap.style.width = `${widthPct}%`;
  photoWrap.style.marginLeft = `${offset}%`;
}

function applyPhotoObjectPosition(img, page) {
  const xRaw = Number(page.photoPosX);
  const yRaw = Number(page.photoPosY);
  const x = Number.isFinite(xRaw) ? Math.max(0, Math.min(100, xRaw)) : 50;
  const y = Number.isFinite(yRaw) ? Math.max(0, Math.min(100, yRaw)) : 50;
  page.photoPosX = x;
  page.photoPosY = y;
  img.style.objectPosition = `${x}% ${y}%`;
}

function enablePhotoEdgeResize(photoWrap, img, page, creationId) {
  const MIN_H = 90;
  const MAX_H = 420;
  const MIN_W = 35;
  const MAX_W = 100;
  let mode = null;
  let startX = 0;
  let startY = 0;
  let startHeight = 0;
  let startWidthPct = 100;
  let startOffsetPct = 0;
  let startPosX = 50;
  let startPosY = 50;

  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

  function applyFromState() {
    applyPhotoHeight(photoWrap, page, creationId);
    applyPhotoObjectPosition(img, page);
  }

  function onMove(e) {
    if (!mode) return;

    const rect = photoWrap.getBoundingClientRect();
    const parentRect = photoWrap.parentElement.getBoundingClientRect();
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;

    if (mode === "resizeY" || mode === "resizeXY") {
      page.photoHeightPx = clamp(startHeight + dy, MIN_H, MAX_H);
    }

    if (mode === "resizeX" || mode === "resizeXY") {
      const deltaPct = (dx / parentRect.width) * 100;
      const nextWidth = clamp(startWidthPct + deltaPct, MIN_W, MAX_W);
      page.photoWidthPct = nextWidth;
      page.photoOffsetXPct = clamp(startOffsetPct, 0, 100 - nextWidth);
    }

    if (mode === "moveCrop") {
      const moveXPct = (dx / rect.width) * 100;
      const moveYPct = (dy / rect.height) * 100;
      page.photoPosX = clamp(startPosX - moveXPct, 0, 100);
      page.photoPosY = clamp(startPosY - moveYPct, 0, 100);
    }

    applyFromState();
  }

  function onUp() {
    if (!mode) return;
    mode = null;
    photoWrap.classList.remove("is-resizing");
    document.body.style.cursor = "";
    img.style.cursor = "grab";
    saveState();

    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onUp);
  }

  let handleY = photoWrap.querySelector(".album-photo-resizer-y");
  if (!handleY) {
    handleY = document.createElement("button");
    handleY.type = "button";
    handleY.className = "album-photo-resizer-y";
    handleY.setAttribute("aria-label", "Redimensionner verticalement");
    handleY.textContent = "↕";
    photoWrap.appendChild(handleY);
  }

  let handleX = photoWrap.querySelector(".album-photo-resizer-x");
  if (!handleX) {
    handleX = document.createElement("button");
    handleX.type = "button";
    handleX.className = "album-photo-resizer-x";
    handleX.setAttribute("aria-label", "Redimensionner horizontalement");
    handleX.textContent = "↔";
    photoWrap.appendChild(handleX);
  }

  let handleXY = photoWrap.querySelector(".album-photo-resizer-xy");
  if (!handleXY) {
    handleXY = document.createElement("button");
    handleXY.type = "button";
    handleXY.className = "album-photo-resizer-xy";
    handleXY.setAttribute("aria-label", "Redimensionner librement");
    handleXY.textContent = "⤡";
    photoWrap.appendChild(handleXY);
  }

  function startInteraction(e, nextMode, cursor) {
    e.preventDefault();
    mode = nextMode;
    startX = e.clientX;
    startY = e.clientY;
    startHeight = photoWrap.getBoundingClientRect().height;
    startWidthPct = Number(page.photoWidthPct) || 100;
    startOffsetPct = Number(page.photoOffsetXPct) || 0;
    startPosX = Number(page.photoPosX) || 50;
    startPosY = Number(page.photoPosY) || 50;

    photoWrap.classList.add("is-resizing");
    document.body.style.cursor = cursor;
    if (nextMode === "moveCrop") img.style.cursor = "grabbing";

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }

  handleY.addEventListener("pointerdown", e => startInteraction(e, "resizeY", "ns-resize"));
  handleX.addEventListener("pointerdown", e => startInteraction(e, "resizeX", "ew-resize"));
  handleXY.addEventListener("pointerdown", e => startInteraction(e, "resizeXY", "nwse-resize"));

  img.style.cursor = "grab";
  img.addEventListener("pointerdown", e => {
    startInteraction(e, "moveCrop", "grabbing");
  });
}

function nudgePhotoHeight(photoWrap, page, delta) {
  const MIN_H = 90;
  const MAX_H = 420;
  const current = Math.round(photoWrap.getBoundingClientRect().height);
  const next = Math.max(MIN_H, Math.min(MAX_H, current + delta));
  photoWrap.style.height = `${next}px`;
  photoWrap.style.maxHeight = `${next}px`;
  page.photoHeightPx = next;
  saveState();
}

function applyCardPlacement(card, page) {
  const raw = Number(page.cardShiftX);
  const shift = Number.isFinite(raw) ? raw : 0;
  card.style.transform = `translateX(${shift}px)`;
}

function enableCardPlacement(card, page) {
  const handle = card.querySelector(".album-card-mover");
  if (!handle) return;

  let dragging = false;
  let startX = 0;
  let startShift = 0;

  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

  function onMove(e) {
    if (!dragging) return;

    const parentRect = card.parentElement.getBoundingClientRect();
    const cardRect = card.getBoundingClientRect();
    const maxShift = Math.max(0, (parentRect.width - cardRect.width) / 2);
    const next = clamp(startShift + (e.clientX - startX), -maxShift, maxShift);
    page.cardShiftX = Math.round(next);
    applyCardPlacement(card, page);
  }

  function onUp() {
    if (!dragging) return;
    dragging = false;
    card.classList.remove("is-moving-card");
    document.body.style.cursor = "";
    saveState();

    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onUp);
  }

  handle.addEventListener("pointerdown", e => {
    e.preventDefault();
    dragging = true;
    startX = e.clientX;
    startShift = Number(page.cardShiftX) || 0;
    card.classList.add("is-moving-card");
    document.body.style.cursor = "ew-resize";

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  });
}

function ensurePageBubbles(page) {
  if (!Array.isArray(page.bubbles)) page.bubbles = [];
}

function addSpeechBubble(page) {
  ensurePageBubbles(page);
  page.bubbles.push({
    id: uid(),
    text: "Nouvelle bulle",
    x: 10,
    y: 12,
    w: 44,
    h: 20,
  });
}

function mountSpeechBubbles(host, page) {
  ensurePageBubbles(page);
  host.classList.add("bubble-host");

  const oldLayer = host.querySelector(".speech-layer");
  if (oldLayer) oldLayer.remove();

  const layer = document.createElement("div");
  layer.className = "speech-layer";

  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

  page.bubbles.forEach(bubble => {
    const bubbleEl = document.createElement("div");
    bubbleEl.className = "speech-bubble";

    const w = clamp(Number(bubble.w) || 44, 16, 95);
    const h = clamp(Number(bubble.h) || 20, 10, 70);
    const x = clamp(Number(bubble.x) || 10, 0, 100 - w);
    const y = clamp(Number(bubble.y) || 12, 0, 100 - h);
    bubble.w = w;
    bubble.h = h;
    bubble.x = x;
    bubble.y = y;

    bubbleEl.style.left = `${x}%`;
    bubbleEl.style.top = `${y}%`;
    bubbleEl.style.width = `${w}%`;
    bubbleEl.style.height = `${h}%`;

    const text = document.createElement("textarea");
    text.className = "speech-bubble-text";
    text.value = bubble.text || "";
    text.rows = 1;
    text.addEventListener("input", () => {
      bubble.text = text.value;
      saveState();
    });

    const del = document.createElement("button");
    del.className = "speech-bubble-delete";
    del.type = "button";
    del.textContent = "✕";
    del.setAttribute("aria-label", "Supprimer la bulle");
    del.addEventListener("click", e => {
      e.preventDefault();
      page.bubbles = page.bubbles.filter(b => b.id !== bubble.id);
      saveState();
      mountSpeechBubbles(host, page);
    });

    const resize = document.createElement("button");
    resize.className = "speech-bubble-resize";
    resize.type = "button";
    resize.textContent = "⤡";
    resize.setAttribute("aria-label", "Redimensionner la bulle");

    bubbleEl.appendChild(text);
    bubbleEl.appendChild(del);
    bubbleEl.appendChild(resize);

    let mode = null;
    let startX = 0;
    let startY = 0;
    let startBubble = { x: x, y: y, w: w, h: h };

    function onMove(e) {
      if (!mode) return;
      const rect = host.getBoundingClientRect();
      const dxPct = (e.clientX - startX) / rect.width * 100;
      const dyPct = (e.clientY - startY) / rect.height * 100;

      if (mode === "move") {
        bubble.x = clamp(startBubble.x + dxPct, 0, 100 - bubble.w);
        bubble.y = clamp(startBubble.y + dyPct, 0, 100 - bubble.h);
      }

      if (mode === "resize") {
        bubble.w = clamp(startBubble.w + dxPct, 16, 100 - bubble.x);
        bubble.h = clamp(startBubble.h + dyPct, 10, 100 - bubble.y);
      }

      bubbleEl.style.left = `${bubble.x}%`;
      bubbleEl.style.top = `${bubble.y}%`;
      bubbleEl.style.width = `${bubble.w}%`;
      bubbleEl.style.height = `${bubble.h}%`;
    }

    function onUp() {
      if (!mode) return;
      mode = null;
      saveState();
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    }

    bubbleEl.addEventListener("pointerdown", e => {
      if (e.target === text || e.target === del || e.target === resize) return;
      e.preventDefault();
      mode = "move";
      startX = e.clientX;
      startY = e.clientY;
      startBubble = { x: bubble.x, y: bubble.y, w: bubble.w, h: bubble.h };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    });

    resize.addEventListener("pointerdown", e => {
      e.preventDefault();
      mode = "resize";
      startX = e.clientX;
      startY = e.clientY;
      startBubble = { x: bubble.x, y: bubble.y, w: bubble.w, h: bubble.h };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    });

    layer.appendChild(bubbleEl);
  });

  host.appendChild(layer);
}

// ──────────────────────────────────────────────────
// NAVIGATION
// ──────────────────────────────────────────────────

function navigate(screenId) {
  if (screenId !== "screen-preview") stopStoryPlayback();
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  const target = document.getElementById(screenId);
  if (target) target.classList.add("active");
}

// ──────────────────────────────────────────────────
// HOME SCREEN
// ──────────────────────────────────────────────────

function renderHome() {
  const grid   = document.getElementById("creations-grid");
  const empty  = document.getElementById("empty-state");
  const filter = STATE.homeTypeFilter;

  const filtered = filter === "all"
    ? STATE.creations
    : STATE.creations.filter(c => {
        if (filter === "carte") return c.type.startsWith("carte");
        return c.type === filter;
      });

  // Remove old cards (keep empty-state)
  grid.querySelectorAll(".creation-card").forEach(el => el.remove());

  if (filtered.length === 0) {
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");

  filtered.forEach(creation => {
    const card     = document.createElement("div");
    const typeInfo = CREATION_TYPES[creation.type] || { label: creation.type, icon: "📄" };
    const coverPage = creation.pages?.[0];
    const cover    = coverPage?.photoDataUrl;
    const coverPosX = Number(coverPage?.photoPosX);
    const coverPosY = Number(coverPage?.photoPosY);
    const safePosX = Number.isFinite(coverPosX) ? Math.max(0, Math.min(100, coverPosX)) : 50;
    const safePosY = Number.isFinite(coverPosY) ? Math.max(0, Math.min(100, coverPosY)) : 50;

    card.className = "creation-card";
    card.dataset.id = creation.id;
    card.innerHTML = `
      <div class="creation-card-cover">
        ${cover ? `<img src="${cover}" alt="" style="object-position:${safePosX}% ${safePosY}%;" />` : typeInfo.icon}
      </div>
      <div class="creation-card-info">
        <div class="creation-card-title">${creation.title || "Sans titre"}</div>
        <div class="creation-card-meta">${formatDate(creation.createdAt)} · ${creation.pages?.length ?? 0} page${(creation.pages?.length ?? 0) !== 1 ? "s" : ""}</div>
      </div>
      <div class="creation-card-badge">${typeInfo.label}</div>
    `;

    card.addEventListener("click", () => openEditor(creation.id));
    card.addEventListener("contextmenu", e => { e.preventDefault(); confirmDelete(creation.id); });

    grid.appendChild(card);
  });
}

// ──────────────────────────────────────────────────
// CREATE NEW CREATION
// ──────────────────────────────────────────────────

function openTypePicker() {
  navigate("screen-type-picker");
}

function createCreation(type) {
  const creation = {
    id:        uid(),
    type,
    title:     "",
    createdAt: new Date().toISOString(),
    pages:     [],
    design:    { template: "simple", bgColor: "#ffffff", font: "serif" },
  };
  STATE.creations.unshift(creation);
  STATE.photoScaleByCreation[creation.id] = 70;
  saveState();
  openEditor(creation.id);
}

// ──────────────────────────────────────────────────
// EDITOR SCREEN
// ──────────────────────────────────────────────────

function openEditor(id) {
  const creation = STATE.creations.find(c => c.id === id);
  if (!creation) return;
  STATE.activeCreationId = id;
  applyPhotoScaleToUi(id);

  document.getElementById("editor-title").value = creation.title || "";
  showEditorTab("pages");
  renderAlbum(creation);
  renderDesignPanel(creation);
  navigate("screen-editor");
}

function showEditorTab(tab) {
  document.querySelectorAll(".editor-tab").forEach(t => {
    t.classList.toggle("active", t.dataset.tab === tab);
  });
  document.querySelectorAll(".editor-panel").forEach(p => {
    p.classList.toggle("active", p.id === `panel-${tab}`);
  });
}

function renderAlbum(creation) {
  const scroll = document.getElementById("album-scroll");
  const empty  = document.getElementById("album-empty");
  applyPhotoScaleToUi(creation.id);

  // Remove existing cards/views
  scroll.querySelectorAll(".album-card, .book-shell").forEach(el => el.remove());

  if (!creation.pages.length) {
    empty.style.display = "";
    return;
  }
  empty.style.display = "none";

  if (creation.type === "livre") {
    const maxIndex = creation.pages.length - 1;
    const savedIndex = STATE.bookPageIndexByCreation[creation.id] ?? 0;
    const currentIndex = Math.max(0, Math.min(savedIndex, maxIndex));
    const page = creation.pages[currentIndex];
    ensurePageCategory(page);
    STATE.bookPageIndexByCreation[creation.id] = currentIndex;

    const book = document.createElement("div");
    book.className = "book-shell";

    const viewport = document.createElement("div");
    viewport.className = "book-viewport";

    const sheet = document.createElement("article");
    sheet.className = "book-sheet";

    const photoWrap = document.createElement("div");
    photoWrap.className = "album-photo-wrap";

    const img = document.createElement("img");
    img.src = page.photoDataUrl || "";
    img.alt = "";
    img.style.filter = CSS_FILTERS[page.filter] || "none";
    photoWrap.appendChild(img);
    applyPhotoHeight(photoWrap, page, creation.id);
    applyPhotoObjectPosition(img, page);
    enablePhotoEdgeResize(photoWrap, img, page, creation.id);

    (page.annotations || [])
      .filter(a => a.type === "sticker")
      .forEach(a => {
        const s = document.createElement("span");
        s.className = "album-sticker";
        s.textContent = a.emoji;
        s.style.left = `${a.x * 100}%`;
        s.style.top  = `${a.y * 100}%`;
        photoWrap.appendChild(s);
      });

    sheet.appendChild(photoWrap);

    const dateEl = document.createElement("div");
    dateEl.className = "album-date";
    dateEl.textContent = formatDate(page.photoTakenAt || page.addedAt || creation.createdAt);
    sheet.appendChild(dateEl);

    const categoryWrap = document.createElement("div");
    categoryWrap.className = "page-category-wrap";
    const categoryLabel = document.createElement("span");
    categoryLabel.className = "page-category-label";
    categoryLabel.textContent = "Catégorie";
    const categorySelect = document.createElement("select");
    categorySelect.className = "page-category-select";
    STORY_CATEGORIES.forEach(cat => {
      const opt = document.createElement("option");
      opt.value = cat.id;
      opt.textContent = cat.label;
      if (page.category === cat.id) opt.selected = true;
      categorySelect.appendChild(opt);
    });
    categorySelect.addEventListener("change", () => {
      page.category = categorySelect.value;
      saveState();
    });
    categoryWrap.appendChild(categoryLabel);
    categoryWrap.appendChild(categorySelect);
    sheet.appendChild(categoryWrap);

    const textAnnotations = (page.annotations || []).filter(a => a.type === "text");
    if (textAnnotations.length) {
      textAnnotations.forEach(a => {
        const inline = document.createElement("div");
        inline.className = "album-caption";
        inline.style.cssText = `color:${a.color||"inherit"};font-size:${a.size ? a.size * 0.75 : 14}px;padding:2px 14px 0;min-height:unset`;
        inline.textContent = a.content;
        sheet.appendChild(inline);
      });
    }

    const caption = document.createElement("textarea");
    caption.className = "album-caption";
    caption.placeholder = "Ajoute une légende...";
    caption.value = page.caption || "";
    caption.rows = 2;
    caption.addEventListener("input", () => {
      caption.style.height = "auto";
      caption.style.height = caption.scrollHeight + "px";
    });
    caption.addEventListener("blur", () => {
      page.caption = caption.value;
      saveState();
    });
    sheet.appendChild(caption);
    requestAnimationFrame(() => {
      caption.style.height = "auto";
      caption.style.height = caption.scrollHeight + "px";
    });

    mountSpeechBubbles(sheet, page);

    viewport.appendChild(sheet);
    book.appendChild(viewport);

    const controls = document.createElement("div");
    controls.className = "book-controls";

    const prev = document.createElement("button");
    prev.className = "book-nav-btn";
    prev.textContent = "← Page précédente";
    prev.disabled = currentIndex === 0;

    const pager = document.createElement("div");
    pager.className = "book-pager";
    pager.textContent = `Page ${currentIndex + 1} / ${creation.pages.length}`;

    const next = document.createElement("button");
    next.className = "book-nav-btn";
    next.textContent = "Page suivante →";
    next.disabled = currentIndex === maxIndex;

    controls.appendChild(prev);
    controls.appendChild(pager);
    controls.appendChild(next);
    book.appendChild(controls);

    const actions = document.createElement("div");
    actions.className = "book-actions";

    const btnAnnot = document.createElement("button");
    btnAnnot.className = "album-action-btn";
    btnAnnot.innerHTML = "✏️ Annoter / filtres";
    btnAnnot.addEventListener("click", () => openPageEditor(currentIndex));

    const btnSmaller = document.createElement("button");
    btnSmaller.className = "album-action-btn";
    btnSmaller.textContent = "−";
    btnSmaller.addEventListener("click", () => nudgePhotoHeight(photoWrap, page, -16));

    const btnBigger = document.createElement("button");
    btnBigger.className = "album-action-btn";
    btnBigger.textContent = "+";
    btnBigger.addEventListener("click", () => nudgePhotoHeight(photoWrap, page, 16));

    const btnBubble = document.createElement("button");
    btnBubble.className = "album-action-btn";
    btnBubble.textContent = "💬 Bulle";
    btnBubble.addEventListener("click", () => {
      addSpeechBubble(page);
      saveState();
      renderAlbum(creation);
    });

    const btnDelete = document.createElement("button");
    btnDelete.className = "album-action-btn danger";
    btnDelete.innerHTML = "🗑️ Supprimer cette page";
    btnDelete.addEventListener("click", () => {
      creation.pages.splice(currentIndex, 1);
      const nextIndex = Math.max(0, currentIndex - 1);
      STATE.bookPageIndexByCreation[creation.id] = nextIndex;
      saveState();
      renderAlbum(creation);
    });

    actions.appendChild(btnAnnot);
    actions.appendChild(btnSmaller);
    actions.appendChild(btnBigger);
    actions.appendChild(btnBubble);
    actions.appendChild(btnDelete);
    book.appendChild(actions);

    function animateTurn(delta) {
      if (STATE.bookAnimating) return;
      const targetIndex = currentIndex + delta;
      if (targetIndex < 0 || targetIndex > maxIndex) return;

      STATE.bookAnimating = true;
      const outClass = delta > 0 ? "book-turn-out-next" : "book-turn-out-prev";
      sheet.classList.add(outClass);

      sheet.addEventListener("animationend", () => {
        STATE.bookPageIndexByCreation[creation.id] = targetIndex;
        STATE.bookAnimateDirection = delta > 0 ? "next" : "prev";
        renderAlbum(creation);
      }, { once: true });
    }

    prev.addEventListener("click", () => animateTurn(-1));
    next.addEventListener("click", () => animateTurn(1));

    scroll.appendChild(book);

    if (STATE.bookAnimateDirection) {
      const inClass = STATE.bookAnimateDirection === "next"
        ? "book-turn-in-next"
        : "book-turn-in-prev";
      requestAnimationFrame(() => {
        sheet.classList.add(inClass);
        sheet.addEventListener("animationend", () => {
          STATE.bookAnimating = false;
          STATE.bookAnimateDirection = null;
          sheet.classList.remove(inClass);
        }, { once: true });
      });
    }

    return;
  }

  creation.pages.forEach((page, i) => {
    ensurePageCategory(page);
    const card = document.createElement("div");
    card.className = "album-card";
    card.dataset.pageId = page.id;
    card.innerHTML = '<div class="album-card-mover" title="Déplacer le bloc photo">↔ Déplacer</div>';
    applyCardPlacement(card, page);
    enableCardPlacement(card, page);

    // ── Photo + sticker overlays ──────────────────
    const photoWrap = document.createElement("div");
    photoWrap.className = "album-photo-wrap";

    const img = document.createElement("img");
    img.src = page.photoDataUrl || "";
    img.alt = "";
    img.style.filter = CSS_FILTERS[page.filter] || "none";
    photoWrap.appendChild(img);
    applyPhotoHeight(photoWrap, page, creation.id);
    applyPhotoObjectPosition(img, page);
    enablePhotoEdgeResize(photoWrap, img, page, creation.id);

    // Sticker overlays (positioned as % of photo)
    (page.annotations || [])
      .filter(a => a.type === "sticker")
      .forEach(a => {
        const s = document.createElement("span");
        s.className = "album-sticker";
        s.textContent = a.emoji;
        s.style.left = `${a.x * 100}%`;
        s.style.top  = `${a.y * 100}%`;
        photoWrap.appendChild(s);
      });

    card.appendChild(photoWrap);

    // ── Date stamp ────────────────────────────────
    const dateEl = document.createElement("div");
    dateEl.className = "album-date";
    dateEl.textContent = formatDate(page.photoTakenAt || page.addedAt || creation.createdAt);
    card.appendChild(dateEl);

    const categoryWrap = document.createElement("div");
    categoryWrap.className = "page-category-wrap";
    const categoryLabel = document.createElement("span");
    categoryLabel.className = "page-category-label";
    categoryLabel.textContent = "Catégorie";
    const categorySelect = document.createElement("select");
    categorySelect.className = "page-category-select";
    STORY_CATEGORIES.forEach(cat => {
      const opt = document.createElement("option");
      opt.value = cat.id;
      opt.textContent = cat.label;
      if (page.category === cat.id) opt.selected = true;
      categorySelect.appendChild(opt);
    });
    categorySelect.addEventListener("change", () => {
      page.category = categorySelect.value;
      saveState();
    });
    categoryWrap.appendChild(categoryLabel);
    categoryWrap.appendChild(categorySelect);
    card.appendChild(categoryWrap);

    // ── Text annotations below photo ─────────────
    const textAnnotations = (page.annotations || []).filter(a => a.type === "text");
    if (textAnnotations.length) {
      textAnnotations.forEach(a => {
        const inline = document.createElement("div");
        inline.className = "album-caption";
        inline.style.cssText = `color:${a.color||"inherit"};font-size:${a.size ? a.size * 0.75 : 14}px;padding:2px 14px 0;min-height:unset`;
        inline.textContent = a.content;
        card.appendChild(inline);
      });
    }

    // ── Caption (editable) ────────────────────────
    const caption = document.createElement("textarea");
    caption.className = "album-caption";
    caption.placeholder = "Ajoute une légende...";
    caption.value = page.caption || "";
    caption.rows = 2;
    caption.addEventListener("input", () => {
      caption.style.height = "auto";
      caption.style.height = caption.scrollHeight + "px";
    });
    caption.addEventListener("blur", () => {
      page.caption = caption.value;
      saveState();
    });
    card.appendChild(caption);
    // Auto-resize on next paint
    requestAnimationFrame(() => {
      caption.style.height = "auto";
      caption.style.height = caption.scrollHeight + "px";
    });

    mountSpeechBubbles(card, page);

    // ── Footer actions ────────────────────────────
    const footer = document.createElement("div");
    footer.className = "album-card-footer";

    const btnAnnot = document.createElement("button");
    btnAnnot.className = "album-action-btn";
    btnAnnot.innerHTML = "✏️ Annoter / filtres";
    btnAnnot.addEventListener("click", () => openPageEditor(i));

    const btnSmaller = document.createElement("button");
    btnSmaller.className = "album-action-btn";
    btnSmaller.textContent = "−";
    btnSmaller.addEventListener("click", () => nudgePhotoHeight(photoWrap, page, -16));

    const btnBigger = document.createElement("button");
    btnBigger.className = "album-action-btn";
    btnBigger.textContent = "+";
    btnBigger.addEventListener("click", () => nudgePhotoHeight(photoWrap, page, 16));

    const btnBubble = document.createElement("button");
    btnBubble.className = "album-action-btn";
    btnBubble.textContent = "💬 Bulle";
    btnBubble.addEventListener("click", () => {
      addSpeechBubble(page);
      saveState();
      renderAlbum(creation);
    });

    const spacer = document.createElement("span");
    spacer.className = "album-action-btn-spacer";

    const btnDel = document.createElement("button");
    btnDel.className = "album-action-btn danger";
    btnDel.innerHTML = "🗑️";
    btnDel.addEventListener("click", () => {
      creation.pages.splice(i, 1);
      saveState();
      renderAlbum(creation);
    });

    footer.appendChild(btnAnnot);
    footer.appendChild(btnSmaller);
    footer.appendChild(btnBigger);
    footer.appendChild(btnBubble);
    footer.appendChild(spacer);
    footer.appendChild(btnDel);
    card.appendChild(footer);

    scroll.appendChild(card);
  });
}

function renderDesignPanel(creation) {
  const d = creation.design;

  // Template
  document.querySelectorAll(".template-chip").forEach(chip => {
    chip.classList.toggle("active", chip.dataset.template === d.template);
  });

  // BG Color
  const bgPicker = document.getElementById("bg-color-picker");
  if (bgPicker) bgPicker.value = d.bgColor || "#ffffff";

  // Font
  const fontPicker = document.getElementById("font-picker");
  if (fontPicker) fontPicker.value = d.font || "serif";
}

function saveEditorTitle() {
  const creation = STATE.creations.find(c => c.id === STATE.activeCreationId);
  if (!creation) return;
  creation.title = document.getElementById("editor-title").value.trim();
  saveState();
}

// ── Add page via file input ─────────────────────────
function addPage() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.multiple = true;

  input.addEventListener("change", () => {
    const creation = STATE.creations.find(c => c.id === STATE.activeCreationId);
    if (!creation || !input.files?.length) return;

    Array.from(input.files).forEach(file => {
      const takenAtPromise = extractPhotoTakenDate(file);
      const reader = new FileReader();
      reader.onload = async e => {
        const photoTakenAt = await takenAtPromise;
        creation.pages.push({
          id:           uid(),
          photoDataUrl: e.target.result,
          addedAt:      new Date().toISOString(),
          photoTakenAt,
          category: "souvenir",
          filter:       "none",
          caption:      "",
          photoHeightPx: null,
          photoWidthPct: 100,
          photoOffsetXPct: 0,
          photoPosX: 50,
          photoPosY: 50,
          bubbles: [],
          annotations:  [],
        });
        saveState();
        renderAlbum(creation);
      };
      reader.readAsDataURL(file);
    });
  });

  input.click();
}

// ──────────────────────────────────────────────────
// PAGE EDITOR (canvas / annotations)
// ──────────────────────────────────────────────────

function openPageEditor(pageIndex) {
  const creation = STATE.creations.find(c => c.id === STATE.activeCreationId);
  if (!creation) return;
  const page = creation.pages[pageIndex];
  if (!page) return;

  STATE.activePageIndex    = pageIndex;
  STATE.selectedAnnotationId = null;
  STATE.activeTool         = "select";
  STATE.activeFilter       = page.filter || "none";

  document.getElementById("page-editor-title").textContent = `Page ${pageIndex + 1}`;
  document.getElementById("canvas-photo").src = page.photoDataUrl || "";
  document.getElementById("canvas-photo").style.filter = CSS_FILTERS[page.filter] || "none";

  setActiveTool("select");
  hideAllToolPanels();
  renderAnnotations(page);
  renderFilterChips(page.filter || "none");

  navigate("screen-page-editor");
}

function renderAnnotations(page) {
  const stage = document.getElementById("canvas-stage");
  stage.querySelectorAll(".annotation").forEach(el => el.remove());

  (page.annotations || []).forEach(ann => {
    createAnnotationEl(ann);
  });
}

function createAnnotationEl(ann) {
  const stage = document.getElementById("canvas-stage");
  const el    = document.createElement("div");
  el.className = "annotation";
  el.dataset.id = ann.id;
  el.style.left = `${ann.x * 100}%`;
  el.style.top  = `${ann.y * 100}%`;

  if (ann.type === "text") {
    el.classList.add("annotation-text");
    el.textContent      = ann.content;
    el.style.color      = ann.color || "#ffffff";
    el.style.fontSize   = `${ann.size || 20}px`;
    el.style.fontFamily = ann.font || "inherit";
  } else if (ann.type === "sticker") {
    el.classList.add("annotation-sticker");
    el.textContent = ann.emoji;
  }

  // Delete button (shown when selected)
  const del = document.createElement("button");
  del.className = "annotation-delete";
  del.textContent = "✕";
  del.style.display = "none";
  del.addEventListener("click", e => {
    e.stopPropagation();
    deleteAnnotation(ann.id);
  });
  el.appendChild(del);

  // Drag support
  makeDraggable(el, ann);

  el.addEventListener("click", e => {
    e.stopPropagation();
    if (STATE.activeTool === "select") selectAnnotation(ann.id);
  });

  stage.appendChild(el);
  return el;
}

function selectAnnotation(id) {
  // Deselect all
  document.querySelectorAll(".annotation").forEach(el => {
    el.classList.remove("selected");
    el.querySelector(".annotation-delete").style.display = "none";
  });

  if (!id) { STATE.selectedAnnotationId = null; return; }

  const el = document.querySelector(`.annotation[data-id="${id}"]`);
  if (el) {
    el.classList.add("selected");
    el.querySelector(".annotation-delete").style.display = "flex";
  }
  STATE.selectedAnnotationId = id;
}

function deleteAnnotation(id) {
  const creation = STATE.creations.find(c => c.id === STATE.activeCreationId);
  if (!creation) return;
  const page = creation.pages[STATE.activePageIndex];
  if (!page) return;
  page.annotations = page.annotations.filter(a => a.id !== id);
  saveState();
  renderAnnotations(page);
  selectAnnotation(null);
}

function addTextAnnotation() {
  const input  = document.getElementById("text-input");
  const color  = document.getElementById("text-color").value;
  const size   = parseInt(document.getElementById("text-size").value);
  const text   = input.value.trim();
  if (!text) { showToast("Écris du texte d'abord 👆"); return; }

  const creation = STATE.creations.find(c => c.id === STATE.activeCreationId);
  if (!creation) return;
  const page = creation.pages[STATE.activePageIndex];
  if (!page) return;

  const ann = { id: uid(), type: "text", content: text, x: 0.1, y: 0.1, color, size };
  page.annotations.push(ann);
  saveState();
  renderAnnotations(page);
  input.value = "";
  showToast("Texte ajouté ✓");
}

function addStickerAnnotation(emoji) {
  const creation = STATE.creations.find(c => c.id === STATE.activeCreationId);
  if (!creation) return;
  const page = creation.pages[STATE.activePageIndex];
  if (!page) return;

  const ann = { id: uid(), type: "sticker", emoji, x: 0.1, y: 0.1 };
  page.annotations.push(ann);
  saveState();
  renderAnnotations(page);
  hideAllToolPanels();
  showToast("Sticker ajouté ✓");
}

function applyFilter(filterKey) {
  const creation = STATE.creations.find(c => c.id === STATE.activeCreationId);
  if (!creation) return;
  const page = creation.pages[STATE.activePageIndex];
  if (!page) return;

  page.filter = filterKey;
  document.getElementById("canvas-photo").style.filter = CSS_FILTERS[filterKey] || "none";
  saveState();
  renderFilterChips(filterKey);
}

function renderFilterChips(activeFilter) {
  document.querySelectorAll(".filter-chip").forEach(chip => {
    chip.classList.toggle("active", chip.dataset.filter === activeFilter);
  });
}

// ── Drag to move annotations ────────────────────────
function makeDraggable(el, ann) {
  let startX, startY, startLeft, startTop;

  function onMove(ex, ey) {
    const stage = document.getElementById("canvas-stage");
    const rect  = stage.getBoundingClientRect();
    const newLeft = startLeft + (ex - startX);
    const newTop  = startTop  + (ey - startY);
    el.style.left = `${newLeft}px`;
    el.style.top  = `${newTop}px`;
    ann.x = newLeft / rect.width;
    ann.y = newTop  / rect.height;
  }

  el.addEventListener("pointerdown", e => {
    if (STATE.activeTool !== "select") return;
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    const rect = el.parentElement.getBoundingClientRect();
    startX    = e.clientX;
    startY    = e.clientY;
    startLeft = ann.x * rect.width;
    startTop  = ann.y * rect.height;

    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up, { once: true });
  });

  function move(e) { onMove(e.clientX, e.clientY); }
  function up()    {
    el.removeEventListener("pointermove", move);
    saveState();
  }
}

// ──────────────────────────────────────────────────
// TOOL MANAGEMENT
// ──────────────────────────────────────────────────

function setActiveTool(tool) {
  STATE.activeTool = tool;
  document.querySelectorAll(".tool-btn[data-tool]").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.tool === tool);
  });
  hideAllToolPanels();
  selectAnnotation(null);

  if (tool === "text")    document.getElementById("tool-panel-text").classList.remove("hidden");
  if (tool === "sticker") document.getElementById("tool-panel-sticker").classList.remove("hidden");
  if (tool === "filter")  document.getElementById("tool-panel-filter").classList.remove("hidden");
}

function hideAllToolPanels() {
  document.querySelectorAll(".tool-panel").forEach(p => p.classList.add("hidden"));
}

// ──────────────────────────────────────────────────
// DELETE CREATION
// ──────────────────────────────────────────────────

let _pendingDeleteId = null;

function confirmDelete(id) {
  _pendingDeleteId = id;
  const creation = STATE.creations.find(c => c.id === id);
  document.getElementById("modal-delete-body").textContent =
    `"${creation?.title || "Sans titre"}" sera supprimée définitivement.`;
  document.getElementById("modal-delete").classList.remove("hidden");
}

function deleteCreation(id) {
  STATE.creations = STATE.creations.filter(c => c.id !== id);
  saveState();
  renderHome();
  showToast("Création supprimée");
}

function renderStorySlides(creation, category = "all", startIndex = 0) {
  const container = document.getElementById("preview-container");
  if (!container) return;

  stopStoryPlayback();
  STATE.storyPlayer.creationId = creation.id;
  STATE.storyPlayer.category = category;

  const pages = (creation.pages || []).filter(p => {
    ensurePageCategory(p);
    return category === "all" ? true : p.category === category;
  });

  container.innerHTML = "";

  if (!pages.length) {
    const empty = document.createElement("div");
    empty.className = "story-empty";
    empty.textContent = "Aucune slide dans cette catégorie.";
    container.appendChild(empty);
    return;
  }

  const categoriesBar = document.createElement("div");
  categoriesBar.className = "story-categories";

  const allChip = document.createElement("button");
  allChip.className = "story-cat-chip" + (category === "all" ? " active" : "");
  allChip.textContent = "Toutes";
  allChip.addEventListener("click", () => renderStorySlides(creation, "all", 0));
  categoriesBar.appendChild(allChip);

  STORY_CATEGORIES.forEach(cat => {
    const chip = document.createElement("button");
    chip.className = "story-cat-chip" + (category === cat.id ? " active" : "");
    chip.textContent = cat.label;
    chip.addEventListener("click", () => renderStorySlides(creation, cat.id, 0));
    categoriesBar.appendChild(chip);
  });

  const progress = document.createElement("div");
  progress.className = "story-progress";
  pages.forEach(() => {
    const bar = document.createElement("span");
    bar.className = "story-progress-bar";
    progress.appendChild(bar);
  });

  const viewport = document.createElement("div");
  viewport.className = "story-viewport";

  const slide = document.createElement("article");
  slide.className = "story-slide";

  const media = document.createElement("div");
  media.className = "story-media";
  const img = document.createElement("img");
  media.appendChild(img);

  const meta = document.createElement("div");
  meta.className = "story-meta";
  const title = document.createElement("div");
  title.className = "story-meta-title";
  const date = document.createElement("div");
  date.className = "story-meta-date";
  const caption = document.createElement("div");
  caption.className = "story-meta-caption";
  meta.appendChild(title);
  meta.appendChild(date);
  meta.appendChild(caption);

  slide.appendChild(media);
  slide.appendChild(meta);
  viewport.appendChild(slide);

  const controls = document.createElement("div");
  controls.className = "story-controls";
  const prev = document.createElement("button");
  prev.className = "story-nav";
  prev.textContent = "←";
  const counter = document.createElement("span");
  counter.className = "story-counter";
  const autoState = document.createElement("span");
  autoState.className = "story-auto-state";
  const next = document.createElement("button");
  next.className = "story-nav";
  next.textContent = "→";
  controls.appendChild(prev);
  controls.appendChild(counter);
  controls.appendChild(autoState);
  controls.appendChild(next);

  container.appendChild(categoriesBar);
  container.appendChild(progress);
  container.appendChild(viewport);
  container.appendChild(controls);

  let index = Math.max(0, Math.min(startIndex, pages.length - 1));
  const AUTOPLAY_MS = 3000;

  function scheduleNext() {
    stopStoryPlayback();
    if (pages.length <= 1) return;
    STATE.storyPlayer.timerId = setTimeout(() => {
      go(index + 1, true);
    }, AUTOPLAY_MS);
  }

  function draw() {
    const p = pages[index];
    img.src = p.photoDataUrl || "";
    img.style.filter = CSS_FILTERS[p.filter] || "none";
    img.style.objectPosition = `${Number(p.photoPosX) || 50}% ${Number(p.photoPosY) || 50}%`;
    title.textContent = getCategoryLabel(p.category);
    date.textContent = formatDate(p.photoTakenAt || p.addedAt || creation.createdAt);
    caption.textContent = p.caption || "";
    counter.textContent = `${index + 1} / ${pages.length}`;

    const bars = progress.querySelectorAll(".story-progress-bar");
    bars.forEach((b, i) => b.classList.toggle("active", i <= index));
    autoState.textContent = pages.length <= 1 ? "1 slide" : "Auto";
  }

  function go(nextIndex, fromAuto = false) {
    index = (nextIndex + pages.length) % pages.length;
    STATE.storyPlayer.index = index;
    draw();
    if (fromAuto) {
      scheduleNext();
    } else {
      scheduleNext();
    }
  }

  prev.addEventListener("click", () => go(index - 1));
  next.addEventListener("click", () => go(index + 1));

  draw();
  scheduleNext();
}

function openStoryPreview() {
  const creation = STATE.creations.find(c => c.id === STATE.activeCreationId);
  if (!creation || !creation.pages?.length) {
    showToast("Ajoute des photos pour lancer les slides.");
    return;
  }

  document.getElementById("preview-title").textContent = `${creation.title || "Story"} • Slides`;
  navigate("screen-preview");
  renderStorySlides(creation, STATE.storyPlayer.category || "all", STATE.storyPlayer.index || 0);
}

// ──────────────────────────────────────────────────
// EXPORT (stubs — to be implemented)
// ──────────────────────────────────────────────────

function exportImages() { showToast("Export images — bientôt disponible 🚧"); }
function exportPdf()    { showToast("Export PDF — bientôt disponible 🚧"); }
function exportLink()   { showToast("Partage par lien — bientôt disponible 🚧"); }
function exportQr()     { showToast("QR code — bientôt disponible 🚧"); }

// ──────────────────────────────────────────────────
// SETTINGS
// ──────────────────────────────────────────────────

function openSettings() {
  document.getElementById("storage-mode").value = STATE.storageMode;
  document.getElementById("supabase-url").value  = STATE.supabaseUrl;
  document.getElementById("supabase-key").value  = STATE.supabaseKey;
  navigate("screen-settings");
}

function saveSettings() {
  STATE.storageMode = document.getElementById("storage-mode").value;
  STATE.supabaseUrl = document.getElementById("supabase-url").value.trim();
  STATE.supabaseKey = document.getElementById("supabase-key").value.trim();
  saveState();
  showToast("Réglages sauvegardés ✓");
}

// ──────────────────────────────────────────────────
// INIT — Event Listeners
// ──────────────────────────────────────────────────

function init() {
  loadState();
  applyBuilderCssVars();

  // Sticker grid
  const stickerGrid = document.getElementById("sticker-grid");
  STICKERS.forEach(emoji => {
    const btn = document.createElement("button");
    btn.className = "sticker-option";
    btn.textContent = emoji;
    btn.addEventListener("click", () => addStickerAnnotation(emoji));
    stickerGrid.appendChild(btn);
  });

  // ── Home ──
  document.getElementById("btn-new-creation").addEventListener("click", openTypePicker);
  document.getElementById("btn-open-settings").addEventListener("click", openSettings);

  const photoSizeRange = document.getElementById("album-size-range");
  if (photoSizeRange) {
    photoSizeRange.addEventListener("input", e => {
      if (!STATE.activeCreationId) return;
      const scale = Number(e.target.value || 70);
      STATE.photoScaleByCreation[STATE.activeCreationId] = scale;
      applyPhotoScaleToUi(STATE.activeCreationId);
      saveState();
    });
  }

  initBuilderControls();

  document.querySelectorAll(".type-chip").forEach(chip => {
    chip.addEventListener("click", () => {
      document.querySelectorAll(".type-chip").forEach(c => c.classList.remove("active"));
      chip.classList.add("active");
      STATE.homeTypeFilter = chip.dataset.type;
      renderHome();
    });
  });

  // ── Type picker ──
  document.getElementById("btn-back-from-type").addEventListener("click", () => {
    navigate("screen-home");
    renderHome();
  });
  document.querySelectorAll(".type-card").forEach(card => {
    card.addEventListener("click", () => createCreation(card.dataset.type));
  });

  // ── Editor ──
  document.getElementById("btn-back-from-editor").addEventListener("click", () => {
    saveEditorTitle();
    navigate("screen-home");
    renderHome();
  });
  document.getElementById("editor-title").addEventListener("input", saveEditorTitle);
  document.getElementById("btn-editor-share").addEventListener("click", openStoryPreview);
  document.getElementById("btn-add-page").addEventListener("click", addPage);

  document.querySelectorAll(".editor-tab").forEach(tab => {
    tab.addEventListener("click", () => showEditorTab(tab.dataset.tab));
  });

  document.querySelectorAll(".template-chip").forEach(chip => {
    chip.addEventListener("click", () => {
      const creation = STATE.creations.find(c => c.id === STATE.activeCreationId);
      if (!creation) return;
      creation.design.template = chip.dataset.template;
      saveState();
      document.querySelectorAll(".template-chip").forEach(c => c.classList.remove("active"));
      chip.classList.add("active");
    });
  });

  document.getElementById("bg-color-picker").addEventListener("input", e => {
    const creation = STATE.creations.find(c => c.id === STATE.activeCreationId);
    if (!creation) return;
    creation.design.bgColor = e.target.value;
    saveState();
  });

  document.getElementById("font-picker").addEventListener("change", e => {
    const creation = STATE.creations.find(c => c.id === STATE.activeCreationId);
    if (!creation) return;
    creation.design.font = e.target.value;
    saveState();
  });

  document.getElementById("btn-export-images").addEventListener("click", exportImages);
  document.getElementById("btn-export-pdf").addEventListener("click", exportPdf);
  document.getElementById("btn-export-link").addEventListener("click", exportLink);
  document.getElementById("btn-export-qr").addEventListener("click", exportQr);

  // ── Page editor ──
  document.getElementById("btn-back-from-page").addEventListener("click", () => {
    const creation = STATE.creations.find(c => c.id === STATE.activeCreationId);
    openEditor(STATE.activeCreationId);
    if (creation) renderAlbum(creation);
  });

  document.getElementById("btn-save-page").addEventListener("click", () => {
    saveState();
    showToast("Page sauvegardée ✓");
  });

  document.querySelectorAll(".tool-btn[data-tool]").forEach(btn => {
    btn.addEventListener("click", () => setActiveTool(btn.dataset.tool));
  });

  document.getElementById("btn-add-text").addEventListener("click", addTextAnnotation);

  document.getElementById("canvas-stage").addEventListener("click", e => {
    if (e.target === e.currentTarget || e.target.id === "canvas-photo") {
      selectAnnotation(null);
    }
  });

  document.querySelectorAll(".filter-chip").forEach(chip => {
    chip.addEventListener("click", () => applyFilter(chip.dataset.filter));
  });

  // ── Preview ──
  document.getElementById("btn-back-from-preview").addEventListener("click", () => {
    openEditor(STATE.activeCreationId);
  });
  document.getElementById("btn-preview-share").addEventListener("click", exportLink);

  // ── Settings ──
  document.getElementById("btn-back-from-settings").addEventListener("click", () => {
    saveSettings();
    navigate("screen-home");
    renderHome();
  });

  // ── Delete modal ──
  document.getElementById("btn-delete-cancel").addEventListener("click", () => {
    document.getElementById("modal-delete").classList.add("hidden");
    _pendingDeleteId = null;
  });
  document.getElementById("btn-delete-confirm").addEventListener("click", () => {
    document.getElementById("modal-delete").classList.add("hidden");
    if (_pendingDeleteId) deleteCreation(_pendingDeleteId);
    _pendingDeleteId = null;
  });

  // ── Render home ──
  renderHome();
  navigate("screen-home");
}

document.addEventListener("DOMContentLoaded", init);
