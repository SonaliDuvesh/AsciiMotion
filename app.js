'use strict';

const CHARSETS = {
  'theme-matrix': { label: 'Matrix', ramp: '@#%*+=-:. ', fg: '#00ff41', bg: '#010409' },
  'theme-ibm': { label: 'Retro IBM', ramp: '█▓▒░ ', fg: '#ffffff', bg: '#0000aa' },
  'theme-braille': { label: 'Braille (hi-res)', ramp: null, fg: '#e6edf3', bg: '#010409', braille: true },
  'detailed': { label: 'Detailed', ramp: '@%#*+=-:. ', fg: '#ffffff', bg: '#010409' },
  'simple': { label: 'Simple', ramp: '#*+-:. ', fg: '#ffffff', bg: '#010409' },
  'blocks': { label: 'Blocks', ramp: '█▓▒░ ', fg: '#ffffff', bg: '#010409' },
  'binary': { label: 'Binary', ramp: '01 ', fg: '#ffffff', bg: '#010409' },
};

// DOM elements
const vid = document.getElementById('vid');
const sampleCanvas = document.getElementById('sample-canvas');
const sampleCtx = sampleCanvas ? sampleCanvas.getContext('2d', { willReadFrequently: true }) : null;

const asciiCanvas = document.getElementById('ascii-canvas');
const asciiCtx = asciiCanvas ? asciiCanvas.getContext('2d', { alpha: false }) : null;

const fileInput = document.getElementById('file-input');
const dropOverlay = document.getElementById('drop-overlay');
const dropHint = document.getElementById('drop-hint');
const playbackBar = document.getElementById('playback-bar');

const btnPick = document.getElementById('btn-pick');
const btnRender = document.getElementById('btn-render');
const btnDlJson = document.getElementById('btn-dl-json');
const btnShare = document.getElementById('btn-share');
const btnPlayPause = document.getElementById('btn-playpause');
const scrub = document.getElementById('scrub');
const pbTime = document.getElementById('pb-time');
const iconPlay = document.getElementById('icon-play');
const iconPause = document.getElementById('icon-pause');

const slCols = document.getElementById('sl-cols');
const lblCols = document.getElementById('lbl-cols');
const chkFit = document.getElementById('chk-fit');
const fitHint = document.getElementById('fit-hint');
const asciiPane = document.getElementById('ascii-pane');
const slContrast = document.getElementById('sl-contrast');
const lblContrast = document.getElementById('lbl-contrast');
const selCharset = document.getElementById('sel-charset');
const chkInvert = document.getElementById('chk-invert');
const chkDarkBg = document.getElementById('chk-dark-bg');
const selFps = document.getElementById('sel-fps');
const selFormat = document.getElementById('sel-format');
const slExportCols = document.getElementById('sl-export-cols');
const lblExportCols = document.getElementById('lbl-export-cols');
const warnBox = document.getElementById('warn-box');
const warnText = document.getElementById('warn-text');

const btnBw = document.getElementById('btn-bw');
const btnColor = document.getElementById('btn-color');

const jobDot = document.getElementById('job-dot');
const jobMeta = document.getElementById('job-meta');
const footerText = document.getElementById('footer-text');
const footerRun = document.getElementById('footer-run');

// State
const state = {
  mode: 'color',          // Default to full color mode
  cols: 80,
  contrast: 1.0,
  charset: selCharset ? selCharset.value : 'detailed',
  invert: false,
  darkBg: true,
  exportFps: 24,          // Match video FPS for smooth recording
  // video info
  videoLoaded: false,
  vidW: 0,
  vidH: 0,
  vidDur: 0,
  vidFps: 30,
  // export
  exportedFrames: null,       // [{text, colors}] after export
  isRendering: false,
  // live
  liveActive: false,
  // playback (export preview)
  pbActive: false,
  pbTimer: null,
  pbIndex: 0,
  // run counter
  runNumber: 1,
};
window.state = state;

// Sync button states on load
if (btnBw) btnBw.classList.toggle('active', state.mode === 'bw');
if (btnColor) btnColor.classList.toggle('active', state.mode === 'color');

let stepsComplete = 0;

// Rendering constants
const FONT_PX = 9;
const LINE_H = 10;
const CHAR_W = 5.4;
const EXPORT_SCALE = 2; // Crisp HD 2x scale

// Braille 2×4 sub-pixel offsets
const dotCol = [0, 0, 0, 1, 1, 1, 0, 1];
const dotRow = [0, 1, 2, 0, 1, 2, 3, 3];

function fmtTime(s) {
  if (isNaN(s) || s < 0) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60).toString().padStart(2, '0');
  return `${m}:${sec}`;
}

function elapsed(startMs) {
  return ((Date.now() - startMs) / 1000).toFixed(1) + 's';
}

function setStep(n, st, detail = '') {
  const stepEl = document.getElementById(`step-${n}`);
  const detailEl = document.getElementById(`detail-${n}`);
  if (!stepEl) return;
  stepEl.dataset.state = st;
  if (detailEl) {
    detailEl.textContent = detail;
    detailEl.classList.toggle('active', st === 'running');
  }
}

function finishStep(n, detail = '', startMs = null) {
  const durEl = document.getElementById(`dur-${n}`);
  if (durEl && startMs) durEl.textContent = elapsed(startMs);
  setStep(n, 'done', detail);
  stepsComplete++;
  if (footerText) footerText.textContent = `${stepsComplete} of 4 steps complete`;
}

function errorStep(n, detail = '') {
  setStep(n, 'error', detail);
  setJobState('error');
}

function setJobState(s) {
  if (jobDot) jobDot.dataset.state = s;
}

function resetSteps() {
  stepsComplete = 0;
  for (let i = 0; i < 4; i++) {
    setStep(i, 'idle', '');
    const durEl = document.getElementById(`dur-${i}`);
    if (durEl) durEl.textContent = '';
  }
  if (footerText) footerText.textContent = '0 of 4 steps complete';
}

// Fit-to-window calculation
function computeFitCols() {
  if (!asciiPane) return 80;
  const availW = asciiPane.clientWidth - 16;
  return Math.min(200, Math.max(30, Math.floor(availW / CHAR_W)));
}

function applyFitCols() {
  if (!chkFit || !chkFit.checked) return;
  const cols = computeFitCols();
  state.cols = cols;
  if (lblCols) lblCols.textContent = cols;
  if (slCols) slCols.value = cols;
  updateWarnBox();
}

// UI listeners
if (slCols) {
  slCols.addEventListener('input', () => {
    state.cols = +slCols.value;
    if (lblCols) lblCols.textContent = state.cols;
    updateWarnBox();
    if (state.exportedFrames && !state.liveActive && state.exportedFrames.length) {
      renderFrameToCanvas(state.exportedFrames[state.pbIndex || 0]);
    }
  });
}

if (chkFit) {
  chkFit.addEventListener('change', () => {
    const on = chkFit.checked;
    if (fitHint) fitHint.textContent = on ? 'Fit to window - resize adjusts automatically' : 'Manual column count';
    if (slCols) slCols.disabled = on;
    if (on) {
      applyFitCols();
    } else if (slCols && lblCols) {
      state.cols = +slCols.value;
      lblCols.textContent = state.cols;
    }
    if (state.exportedFrames && !state.liveActive && state.exportedFrames.length) {
      renderFrameToCanvas(state.exportedFrames[state.pbIndex || 0]);
    }
  });
}

if (asciiPane && typeof ResizeObserver !== 'undefined') {
  let fitDebounce = null;
  new ResizeObserver(() => {
    if (!chkFit || !chkFit.checked) return;
    clearTimeout(fitDebounce);
    fitDebounce = setTimeout(() => {
      applyFitCols();
      if (state.exportedFrames && !state.liveActive && state.exportedFrames.length) {
        renderFrameToCanvas(state.exportedFrames[state.pbIndex || 0]);
      }
    }, 120);
  }).observe(asciiPane);
}

if (slContrast) {
  slContrast.addEventListener('input', () => {
    state.contrast = +slContrast.value;
    if (lblContrast) lblContrast.textContent = state.contrast.toFixed(1) + '×';
  });
}

if (selCharset) {
  selCharset.addEventListener('change', () => {
    state.charset = selCharset.value;
    if (state.exportedFrames && !state.liveActive && state.exportedFrames.length) {
      renderFrameToCanvas(state.exportedFrames[state.pbIndex || 0]);
    }
  });
}

if (chkInvert) {
  chkInvert.addEventListener('change', () => {
    state.invert = chkInvert.checked;
  });
}

if (chkDarkBg) {
  chkDarkBg.addEventListener('change', () => {
    state.darkBg = chkDarkBg.checked;
    if (state.exportedFrames && !state.liveActive && state.exportedFrames.length) {
      renderFrameToCanvas(state.exportedFrames[state.pbIndex || 0]);
    }
  });
}

if (selFps) {
  selFps.addEventListener('change', () => {
    state.exportFps = +selFps.value;
    updateWarnBox();
  });
}

if (slExportCols && lblExportCols) {
  slExportCols.addEventListener('input', () => {
    const v = +slExportCols.value;
    lblExportCols.textContent = v === 0 ? 'match preview' : v;
  });
}

// Mode toggle
[btnBw, btnColor].forEach(b => {
  if (!b) return;
  b.addEventListener('click', () => {
    state.mode = b.dataset.mode;
    if (btnBw) btnBw.classList.toggle('active', state.mode === 'bw');
    if (btnColor) btnColor.classList.toggle('active', state.mode === 'color');
    if (state.exportedFrames && !state.liveActive && state.exportedFrames.length) {
      renderFrameToCanvas(state.exportedFrames[state.pbIndex || 0]);
    }
  });
});

function updateWarnBox() {
  if (!warnBox) return;
  if (!state.videoLoaded) { warnBox.classList.add('hidden'); return; }
  const totalFrames = Math.ceil(state.vidDur * state.exportFps);
  const estimate = totalFrames * state.cols;
  if (estimate > 120_000) {
    warnBox.classList.remove('hidden');
    if (warnText) {
      warnText.textContent = `Estimated ${totalFrames} frames × ${state.cols} cols = ${(estimate / 1000).toFixed(0)}k ops. Export may take a few seconds.`;
    }
  } else {
    warnBox.classList.add('hidden');
  }
}

// File loading
if (btnPick) btnPick.addEventListener('click', () => fileInput && fileInput.click());
if (fileInput) {
  fileInput.addEventListener('change', () => {
    if (fileInput.files && fileInput.files[0]) loadVideo(fileInput.files[0]);
  });
}

// Drag and drop
document.addEventListener('dragover', e => {
  e.preventDefault();
  if (dropOverlay) dropOverlay.classList.add('active');
});
document.addEventListener('dragleave', e => {
  if (!e.relatedTarget && dropOverlay) dropOverlay.classList.remove('active');
});
document.addEventListener('drop', e => {
  e.preventDefault();
  if (dropOverlay) dropOverlay.classList.remove('active');
  const f = e.dataTransfer && e.dataTransfer.files[0];
  if (f && f.type.startsWith('video/')) loadVideo(f);
});

function loadVideo(file) {
  stopLive();
  stopPbPlayback();
  resetSteps();
  setJobState('running');
  state.exportedFrames = null;
  state.videoLoaded = false;
  if (btnRender) btnRender.disabled = true;
  if (btnDlJson) btnDlJson.disabled = true;
  if (btnShare) btnShare.disabled = true;
  if (playbackBar) playbackBar.classList.add('hidden');
  if (asciiCanvas) asciiCanvas.hidden = true;
  if (dropHint) dropHint.classList.remove('hidden');
  state.runNumber++;
  if (footerRun) footerRun.textContent = `#${String(state.runNumber).padStart(2, '0')}`;
  if (jobMeta) jobMeta.textContent = 'running · 0s';

  const t0 = Date.now();
  setStep(0, 'running', 'reading file…');
  const url = URL.createObjectURL(file);
  vid.src = url;

  const elapsed0Interval = setInterval(() => {
    if (jobMeta) jobMeta.textContent = `running · ${elapsed(t0)}`;
  }, 500);

  vid.onloadedmetadata = () => {
    state.vidW = vid.videoWidth;
    state.vidH = vid.videoHeight;
    state.vidDur = vid.duration || 0;
    state.vidFps = 30;

    const detail = `${file.name} · ${state.vidW}×${state.vidH} · ${fmtTime(state.vidDur)}`;
    finishStep(0, detail, t0);
    clearInterval(elapsed0Interval);
    state.videoLoaded = true;
    updateWarnBox();

    if (btnRender) btnRender.disabled = false;
    if (btnDlJson) btnDlJson.disabled = false;
    if (btnShare) btnShare.disabled = false;
    if (scrub) scrub.disabled = false;
    if (btnPlayPause) btnPlayPause.disabled = false;

    if (chkFit && chkFit.checked) applyFitCols();
    startLiveMode(t0);
  };

  vid.onerror = () => {
    clearInterval(elapsed0Interval);
    errorStep(0, 'Failed to load video');
    setJobState('error');
    if (jobMeta) jobMeta.textContent = 'failed';
  };
}

// Live playback engine
let liveRafId = null;
let liveVfcActive = false;

function startLiveMode(loadT0) {
  if (dropHint) dropHint.classList.add('hidden');
  if (asciiCanvas) asciiCanvas.hidden = false;
  if (playbackBar) playbackBar.classList.remove('hidden');
  setStep(1, 'running', 'live capture active');
  setStep(2, 'running', 'mapping frames…');

  state.liveActive = true;

  vid.muted = false;
  vid.volume = 1;
  vid.currentTime = 0;
  vid.play().catch(() => { vid.muted = true; vid.play(); });

  if (iconPlay) iconPlay.hidden = true;
  if (iconPause) iconPause.hidden = false;

  vid.ontimeupdate = syncScrub;

  let firstFrame = true;
  function markFirstFrame() {
    if (!firstFrame) return;
    firstFrame = false;
    finishStep(1, 'live stream active', loadT0);
    finishStep(2, 'real-time color/luminance mapping');
    finishStep(3, 'live playback');
    setJobState('success');
    if (jobMeta) jobMeta.textContent = `#${String(state.runNumber).padStart(2, '0')} · live`;
    if (footerText) footerText.textContent = '4 of 4 steps complete (live)';
  }

  function liveVfcLoop(now, meta) {
    if (!state.liveActive) return;
    renderSampledToCanvas();
    markFirstFrame();
    if ('requestVideoFrameCallback' in HTMLVideoElement.prototype) {
      vid.requestVideoFrameCallback(liveVfcLoop);
    } else {
      liveRafId = requestAnimationFrame(liveRafLoop);
    }
  }

  function liveRafLoop() {
    if (!state.liveActive) return;
    renderSampledToCanvas();
    markFirstFrame();
    liveRafId = requestAnimationFrame(liveRafLoop);
  }

  if ('requestVideoFrameCallback' in HTMLVideoElement.prototype) {
    liveVfcActive = true;
    vid.requestVideoFrameCallback(liveVfcLoop);
  } else {
    liveRafLoop();
  }
}

function stopLive() {
  state.liveActive = false;
  liveVfcActive = false;
  if (liveRafId) { cancelAnimationFrame(liveRafId); liveRafId = null; }
  vid.pause();
  vid.ontimeupdate = null;
}

function syncScrub() {
  if (!vid.duration) return;
  if (scrub) scrub.value = Math.round((vid.currentTime / vid.duration) * 1000);
  if (pbTime) pbTime.textContent = `${fmtTime(vid.currentTime)} / ${fmtTime(vid.duration)}`;
}

if (scrub) {
  scrub.addEventListener('input', () => {
    if (state.liveActive) {
      vid.currentTime = (scrub.value / 1000) * (vid.duration || 0);
    } else if (state.exportedFrames && state.exportedFrames.length) {
      const idx = Math.round((scrub.value / 1000) * (state.exportedFrames.length - 1));
      state.pbIndex = idx;
      renderFrameToCanvas(state.exportedFrames[idx]);
      if (pbTime) pbTime.textContent = `${fmtTime(idx / state.exportFps)} / ${fmtTime(state.vidDur)}`;
    }
  });
}

if (btnPlayPause) {
  btnPlayPause.addEventListener('click', () => {
    if (state.liveActive) {
      if (vid.paused) {
        vid.play();
        if (iconPlay) iconPlay.hidden = true;
        if (iconPause) iconPause.hidden = false;
      } else {
        vid.pause();
        if (iconPlay) iconPlay.hidden = false;
        if (iconPause) iconPause.hidden = true;
      }
    } else if (state.exportedFrames && state.exportedFrames.length) {
      if (state.pbActive) stopPbPlayback();
      else startPbPlayback();
    }
  });
}

vid.addEventListener('ended', () => {
  if (iconPlay) iconPlay.hidden = false;
  if (iconPause) iconPause.hidden = true;
});

function startPbPlayback() {
  if (!state.exportedFrames || !state.exportedFrames.length) return;
  state.pbActive = true;
  if (iconPlay) iconPlay.hidden = true;
  if (iconPause) iconPause.hidden = false;
  const interval = 1000 / state.exportFps;
  state.pbTimer = setInterval(() => {
    if (state.pbIndex >= state.exportedFrames.length - 1) {
      state.pbIndex = 0;
    }
    renderFrameToCanvas(state.exportedFrames[state.pbIndex]);
    const t = state.pbIndex / state.exportFps;
    if (pbTime) pbTime.textContent = `${fmtTime(t)} / ${fmtTime(state.vidDur)}`;
    if (scrub) scrub.value = Math.round((state.pbIndex / (state.exportedFrames.length - 1)) * 1000);
    state.pbIndex++;
  }, interval);
}

function stopPbPlayback() {
  state.pbActive = false;
  if (iconPlay) iconPlay.hidden = false;
  if (iconPause) iconPause.hidden = true;
  if (state.pbTimer) { clearInterval(state.pbTimer); state.pbTimer = null; }
}

// Frame sampling optimization
function sampleFrame(sourceEl = vid, colsOverride = null) {
  const vw = sourceEl.videoWidth || sourceEl.width || 640;
  const vh = sourceEl.videoHeight || sourceEl.height || 480;
  const cols = colsOverride || state.cols || 80;
  const charAspect = 0.55;
  const isBraille = CHARSETS[state.charset]?.braille;

  const sw = isBraille ? cols * 2 : cols;
  const sh = isBraille
    ? Math.max(4, Math.round((vh / vw) * cols * charAspect) * 4)
    : Math.max(1, Math.round((vh / vw) * cols * charAspect));

  if (!sampleCanvas || !sampleCtx) return null;

  if (sampleCanvas.width !== sw || sampleCanvas.height !== sh) {
    sampleCanvas.width = sw;
    sampleCanvas.height = sh;
  }

  sampleCtx.filter = `contrast(${state.contrast})`;
  sampleCtx.drawImage(sourceEl, 0, 0, sw, sh);
  return sampleCtx.getImageData(0, 0, sw, sh);
}

// Convert ImageData to ASCII text + exact matching colors
function imageDataToFrame(imageData) {
  if (!imageData) return { text: [], colors: [] };
  const { data, width, height } = imageData;
  const preset = CHARSETS[state.charset] || CHARSETS.detailed;
  const invert = state.invert;

  if (preset.braille) {
    const numCols = Math.floor(width / 2);
    const numRows = Math.floor(height / 4);
    const text = [];
    const colors = [];

    for (let row = 0; row < numRows; row++) {
      let rowStr = '';
      const rowColors = [];
      for (let col = 0; col < numCols; col++) {
        let bits = 0;
        let litCount = 0;
        let rSumLit = 0, gSumLit = 0, bSumLit = 0;
        let rSumAll = 0, gSumAll = 0, bSumAll = 0;

        for (let b = 0; b < 8; b++) {
          const px = Math.min(col * 2 + dotCol[b], width - 1);
          const py = Math.min(row * 4 + dotRow[b], height - 1);
          const idx = (py * width + px) * 4;
          const r = data[idx], g = data[idx + 1], bv = data[idx + 2];
          rSumAll += r; gSumAll += g; bSumAll += bv;
          const lum = (0.299 * r + 0.587 * g + 0.114 * bv) / 255;
          const isLit = invert ? lum < 0.5 : lum >= 0.5;
          if (isLit) {
            bits |= (1 << b);
            litCount++;
            rSumLit += r; gSumLit += g; bSumLit += bv;
          }
        }
        rowStr += String.fromCodePoint(0x2800 + bits);

        if (litCount > 0) {
          rowColors.push(`rgb(${Math.round(rSumLit / litCount)},${Math.round(gSumLit / litCount)},${Math.round(bSumLit / litCount)})`);
        } else {
          rowColors.push(`rgb(${rSumAll >> 3},${gSumAll >> 3},${bSumAll >> 3})`);
        }
      }
      text.push(rowStr);
      colors.push(rowColors);
    }
    return { text, colors };
  }

  const ramp = preset.ramp || CHARSETS.detailed.ramp;
  const rampLen = ramp.length;
  const text = [];
  const colors = [];

  for (let row = 0; row < height; row++) {
    let rowStr = '';
    const rowColors = [];
    const rowOffset = row * width * 4;
    for (let col = 0; col < width; col++) {
      const idx = rowOffset + col * 4;
      const r = data[idx], g = data[idx + 1], b = data[idx + 2];
      const lum = (r * 77 + g * 150 + b * 29) >> 8; // 0..255
      // Corrected Luminance mapping: Bright pixels map to index 0 (dense character), dark pixels to index last (' ')
      const normLum = invert ? (lum / 255) : (1 - lum / 255);
      const charIdx = Math.min(rampLen - 1, Math.max(0, Math.floor(normLum * rampLen)));
      rowStr += ramp[charIdx];
      rowColors.push(`rgb(${r},${g},${b})`);
    }
    text.push(rowStr);
    colors.push(rowColors);
  }
  return { text, colors };
}

function sampleFrameToObj() {
  const imgData = sampleFrame();
  return imageDataToFrame(imgData);
}

function renderSampledToCanvas() {
  const frame = sampleFrameToObj();
  renderFrameToCanvas(frame);
}

// Canvas rendering with exact WYSIWYG matching between preview and export
function renderFrameToCanvas(frame, scale = 1, targetCanvas = asciiCanvas, targetCtx = asciiCtx) {
  if (!frame || !frame.text || !frame.text.length || !targetCanvas || !targetCtx) return;

  const rows = frame.text.length;
  const cols = frame.text[0].length;
  const preset = CHARSETS[state.charset] || CHARSETS.detailed;

  const fontPx = Math.round(FONT_PX * scale);
  const lineH = Math.round(LINE_H * scale);

  targetCtx.font = `${fontPx}px 'JetBrains Mono', 'Consolas', monospace`;
  targetCtx.textBaseline = 'top';

  const measuredW = targetCtx.measureText('M').width;
  const charW = (measuredW && measuredW > 0) ? measuredW : fontPx * 0.6;
  const cw = Math.ceil(cols * charW);
  const ch = rows * lineH;

  if (targetCanvas.width !== cw) targetCanvas.width = cw;
  if (targetCanvas.height !== ch) targetCanvas.height = ch;

  // Background
  if (state.mode === 'color') {
    targetCtx.fillStyle = state.darkBg ? (preset.bg || '#010409') : '#f0f6fc';
  } else {
    targetCtx.fillStyle = preset.bg || '#010409';
  }
  targetCtx.fillRect(0, 0, cw, ch);

  targetCtx.font = `${fontPx}px 'JetBrains Mono', 'Consolas', monospace`;
  targetCtx.textBaseline = 'top';

  if (state.mode === 'bw' || !frame.colors) {
    targetCtx.fillStyle = preset.fg || '#ffffff';
    for (let r = 0; r < rows; r++) {
      targetCtx.fillText(frame.text[r], 0, r * lineH);
    }
  } else {
    // Exact WYSIWYG color rendering matching live preview
    for (let r = 0; r < rows; r++) {
      const rowStr = frame.text[r];
      const rowCols = frame.colors[r];
      if (!rowCols) {
        targetCtx.fillStyle = '#ffffff';
        targetCtx.fillText(rowStr, 0, r * lineH);
        continue;
      }

      const y = r * lineH;
      for (let c = 0; c < cols; c++) {
        const ch = rowStr[c];
        if (ch === ' ' || ch === '\u2800') continue; // Skip empty space
        targetCtx.fillStyle = rowCols[c];
        targetCtx.fillText(ch, Math.round(c * charW), y);
      }
    }
  }
}

// Export Engine
if (btnRender) {
  btnRender.addEventListener('click', startExport);
}

async function startExport() {
  if (state.isRendering || !state.videoLoaded) return;
  stopLive();
  stopPbPlayback();
  resetSteps();

  state.isRendering = true;
  state.exportedFrames = null;
  setJobState('running');

  if (btnRender) btnRender.disabled = true;
  if (btnDlJson) btnDlJson.disabled = true;
  if (btnShare) btnShare.disabled = true;
  if (scrub) scrub.disabled = true;
  if (btnPlayPause) btnPlayPause.disabled = true;
  if (dropHint) dropHint.classList.add('hidden');
  if (asciiCanvas) asciiCanvas.hidden = false;
  if (playbackBar) playbackBar.classList.remove('hidden');

  const exportFps = state.exportFps || 24;
  const duration = state.vidDur || 0;
  const totalFrames = Math.max(1, Math.ceil(duration * exportFps));
  const dt = 1 / exportFps;
  const selFmt = document.getElementById('sel-format');
  const fmt = selFmt ? selFmt.value : 'webm';

  const expCols = (slExportCols && +slExportCols.value) ? +slExportCols.value : state.cols;
  const savedCols = state.cols;
  state.cols = expCols;

  // Step 0: Video loaded
  finishStep(0, `${state.vidW}×${state.vidH} · ${fmtTime(duration)}`);

  // Step 1: Extract raw frames
  const t1 = Date.now();
  setStep(1, 'running', `0 / ${totalFrames} frames`);
  if (jobMeta) jobMeta.textContent = 'running · extracting';

  vid.muted = true;
  const rawFrames = [];

  for (let i = 0; i < totalFrames; i++) {
    const targetTime = Math.min(i * dt, Math.max(0, duration - 0.001));
    await seekTo(vid, targetTime);
    const imgData = sampleFrame(vid, expCols);
    rawFrames.push(imgData);
    setStep(1, 'running', `${i + 1} / ${totalFrames} frames`);
    if (i % 6 === 0) await yieldUI();
  }

  finishStep(1, `${totalFrames} frames captured`, t1);

  // Step 2: Map to ASCII
  const t2 = Date.now();
  setStep(2, 'running', `0 / ${totalFrames} frames`);

  const frames = [];
  for (let i = 0; i < rawFrames.length; i++) {
    frames.push(imageDataToFrame(rawFrames[i]));
    if (i % 8 === 0) {
      setStep(2, 'running', `${i + 1} / ${totalFrames} frames`);
      await yieldUI();
    }
  }

  finishStep(2, `${totalFrames} frames mapped (${state.mode === 'color' ? 'Color' : 'B&W'})`, t2);
  state.exportedFrames = frames;
  state.cols = savedCols;

  // Step 3: Encode Video / GIF
  const t3 = Date.now();
  setStep(3, 'running', `Encoding ${fmt.toUpperCase()} (${state.mode === 'color' ? 'Color' : 'B&W'})…`);

  const sc = EXPORT_SCALE;
  const fr0 = frames[0];
  const rows = fr0.text.length;
  const cols = fr0.text[0].length;
  const fontPx = Math.round(FONT_PX * sc);
  const lineH = Math.round(LINE_H * sc);
  const charW = fontPx * 0.6;
  const expW = Math.ceil(cols * charW);
  const expH = rows * lineH;

  asciiCanvas.width = expW;
  asciiCanvas.height = expH;

  // Paint initial frame before stream capture
  renderFrameToCanvas(fr0, sc);

  if (fmt === 'gif') {
    try {
      if (!window.GIF) {
        await new Promise((res, rej) => {
          const s = document.createElement('script');
          s.src = 'gif.js';
          s.onload = res;
          s.onerror = rej;
          document.head.appendChild(s);
        });
      }

      let workerScript = 'gif.worker.js';
      try {
        const res = await fetch('gif.worker.js');
        if (res.ok) {
          const text = await res.text();
          const blob = new Blob([text], { type: 'application/javascript' });
          workerScript = URL.createObjectURL(blob);
        }
      } catch (e) { /* fallback */ }

      // Use scale 1 for fast & lightweight GIF encoding
      const gifScale = 1;
      const gifW = Math.ceil(cols * CHAR_W * gifScale);
      const gifH = rows * LINE_H * gifScale;

      asciiCanvas.width = gifW;
      asciiCanvas.height = gifH;

      const gif = new window.GIF({
        workers: 4,
        quality: 10,
        workerScript: workerScript,
        width: gifW,
        height: gifH,
        dither: false,
      });

      const delayMs = Math.round(1000 / exportFps);
      for (let i = 0; i < frames.length; i++) {
        renderFrameToCanvas(frames[i], gifScale);
        gif.addFrame(asciiCanvas, { copy: true, delay: delayMs });
        setStep(3, 'running', `GIF capture ${i + 1}/${totalFrames}`);
        if (i % 5 === 0) await yieldUI();
      }

      setStep(3, 'running', 'rendering GIF (0%)…');
      gif.on('progress', p => {
        const pct = Math.round(p * 100);
        setStep(3, 'running', `rendering GIF (${pct}%)…`);
        if (jobMeta) jobMeta.textContent = `rendering GIF · ${pct}%`;
      });

      const blob = await new Promise((res, rej) => {
        gif.on('finished', res);
        gif.on('error', err => rej(new Error((err && err.message) ? err.message : 'GIF worker error')));
        gif.render();
      });

      safeDownload(blob, `ascii-motion-${state.mode}.gif`);
      finishStep(3, 'GIF ready', t3);
    } catch (err) {
      console.error('GIF export error:', err);
      errorStep(3, `GIF error: ${err.message}`);
    }
  } else {
    // Pure Video Recording (WebM / MP4) in full color or B&W
    let mimeType = 'video/webm;codecs=vp9';
    if (fmt === 'mp4' && typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('video/mp4')) {
      mimeType = 'video/mp4';
    } else if (typeof MediaRecorder !== 'undefined') {
      if (MediaRecorder.isTypeSupported('video/webm;codecs=vp9')) {
        mimeType = 'video/webm;codecs=vp9';
      } else if (MediaRecorder.isTypeSupported('video/webm;codecs=vp8')) {
        mimeType = 'video/webm;codecs=vp8';
      } else {
        mimeType = 'video/webm';
      }
    }

    const stream = asciiCanvas.captureStream ? asciiCanvas.captureStream(exportFps) : null;
    let recorder = null;
    const chunks = [];

    if (stream && typeof MediaRecorder !== 'undefined') {
      try {
        recorder = new MediaRecorder(stream, {
          mimeType,
          videoBitsPerSecond: 8_000_000, // 8 Mbps high-definition ASCII text
        });
        recorder.ondataavailable = e => {
          if (e.data && e.data.size > 0) chunks.push(e.data);
        };
        recorder.start();
      } catch (err) {
        console.warn('MediaRecorder init failed, fallback:', err);
        recorder = null;
      }
    }

    const frameInterval = 1000 / exportFps;
    for (let i = 0; i < frames.length; i++) {
      renderFrameToCanvas(frames[i], sc);
      setStep(3, 'running', `frame ${i + 1} / ${totalFrames}`);
      if (scrub) scrub.value = Math.round((i / (totalFrames - 1)) * 1000);
      if (pbTime) pbTime.textContent = `${fmtTime(i * dt)} / ${fmtTime(duration)}`;
      await new Promise(r => setTimeout(r, frameInterval));
    }

    if (recorder && recorder.state !== 'inactive') {
      recorder.stop();
      await new Promise(r => { recorder.onstop = r; });
    }

    if (chunks.length > 0) {
      const ext = mimeType.includes('mp4') ? 'mp4' : 'webm';
      const blob = new Blob(chunks, { type: mimeType });
      safeDownload(blob, `ascii-motion-${state.mode}.${ext}`);
      finishStep(3, `${ext.toUpperCase()} (${state.mode === 'color' ? 'Color' : 'B&W'}) ready`, t3);
    } else {
      triggerJsonDownload();
      finishStep(3, 'Frames extracted (JSON ready)', t3);
    }
  }

  setJobState('success');
  state.isRendering = false;
  if (jobMeta) jobMeta.textContent = `#${String(state.runNumber).padStart(2, '0')} · ${elapsed(t3)} total`;

  if (btnRender) btnRender.disabled = false;
  if (btnDlJson) btnDlJson.disabled = false;
  if (btnShare) btnShare.disabled = false;
  if (scrub) scrub.disabled = false;
  if (btnPlayPause) btnPlayPause.disabled = false;

  state.pbIndex = 0;
  startPbPlayback();
}

if (btnDlJson) {
  btnDlJson.addEventListener('click', () => {
    if (!state.exportedFrames) return;
    triggerJsonDownload();
  });
}

function triggerJsonDownload() {
  if (!state.exportedFrames) return;
  const payload = {
    fps: state.exportFps,
    cols: state.cols,
    width: state.vidW,
    height: state.vidH,
    mode: state.mode,
    frames: state.exportedFrames.map(f => ({
      text: f.text,
      colors: state.mode === 'color' ? f.colors : null,
    })),
  };
  const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
  safeDownload(blob, 'ascii-motion-frames.json');
}

function safeDownload(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(a.href), 12000);
}

function seekTo(video, time) {
  return new Promise(resolve => {
    if (Math.abs(video.currentTime - time) < 0.01) { resolve(); return; }
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      video.removeEventListener('seeked', onSeeked);
      clearTimeout(timer);
      requestAnimationFrame(() => resolve());
    };
    const onSeeked = () => done();
    const timer = setTimeout(done, 150);
    video.addEventListener('seeked', onSeeked, { once: true });
    video.currentTime = time;
  });
}

function yieldUI() {
  return new Promise(r => setTimeout(r, 0));
}

// Expose globals for features.js
window.CHARSETS = CHARSETS;
window.sampleFrame = sampleFrame;
window.imageDataToFrame = imageDataToFrame;
window.renderFrameToCanvas = renderFrameToCanvas;
window.safeDownload = safeDownload;
window.stopLive = stopLive;
window.stopPbPlayback = stopPbPlayback;
window.startPbPlayback = startPbPlayback;
window.resetSteps = resetSteps;
window.setStep = setStep;
window.finishStep = finishStep;
window.setJobState = setJobState;
window.applyFitCols = applyFitCols;
window.fmtTime = fmtTime;
