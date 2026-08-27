(function () {
  'use strict';

  // Elements
  const vid = document.getElementById('vid');
  const asciiCanvas = document.getElementById('ascii-canvas');
  const btnWebcam = document.getElementById('btn-webcam');
  const btnStopcam = document.getElementById('btn-stopcam');
  const camError = document.getElementById('cam-error');

  let webcamStream = null;
  let webcamActive = false;
  let webcamRecorder = null;
  let webcamChunks = [];
  let webcamRafId = null;

  // Webcam activation
  btnWebcam?.addEventListener('click', async () => {
    if (camError) camError.classList.add('hidden');
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      if (camError) {
        camError.textContent = 'Camera access is blocked or not supported on this origin.';
        camError.classList.remove('hidden');
      }
      return;
    }

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 } }, audio: true });
    } catch (err) {
      console.warn('Could not start webcam with audio, trying video only:', err);
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 } } });
      } catch (videoErr) {
        if (camError) {
          camError.textContent = `Camera denied: ${videoErr.message}`;
          camError.classList.remove('hidden');
        }
        return;
      }
    }
    webcamStream = stream;

    if (typeof window.stopLive === 'function') window.stopLive();
    if (typeof window.stopPbPlayback === 'function') window.stopPbPlayback();
    if (typeof window.resetSteps === 'function') window.resetSteps();

    state.exportedFrames = null;
    state.videoLoaded = false;
    webcamActive = true;

    vid.removeAttribute('hidden');
    vid.style.position = 'absolute';
    vid.style.width = '1px';
    vid.style.height = '1px';
    vid.style.opacity = '0.001';
    vid.style.pointerEvents = 'none';
    vid.style.overflow = 'hidden';

    vid.srcObject = webcamStream;
    vid.muted = true;

    let loopStarted = false;
    const safeStartLoop = () => {
      if (loopStarted) return;
      loopStarted = true;
      startWebcamLoop();
    };

    vid.addEventListener('playing', safeStartLoop, { once: true });
    vid.play().then(() => {
      setTimeout(safeStartLoop, 150);
    }).catch(err => {
      console.error('Play webcam failed:', err);
      safeStartLoop();
    });

    document.getElementById('drop-hint')?.classList.add('hidden');
    if (asciiCanvas) asciiCanvas.hidden = false;
    document.getElementById('playback-bar')?.classList.remove('hidden');
    const scrub = document.getElementById('scrub');
    if (scrub) scrub.disabled = true;
    btnWebcam.classList.add('hidden');
    btnStopcam.classList.remove('hidden');

    if (typeof window.setJobState === 'function') window.setJobState('running');
    if (typeof window.setStep === 'function') window.setStep(0, 'running', 'opening camera…');
  });

  function startWebcamLoop() {
    if (typeof window.finishStep === 'function') window.finishStep(0, 'webcam stream active');
    if (typeof window.setStep === 'function') {
      window.setStep(1, 'running', 'live capture');
      window.setStep(2, 'running', 'mapping frames…');
    }
    if (typeof window.setJobState === 'function') window.setJobState('running');

    function webcamRender() {
      if (!webcamActive) return;
      const imgData = window.sampleFrame ? window.sampleFrame(vid) : null;
      if (!imgData) return;
      const frame = window.imageDataToFrame ? window.imageDataToFrame(imgData) : null;
      if (frame && window.renderFrameToCanvas) {
        window.renderFrameToCanvas(frame);
      }
    }

    let first = true;
    const loop = () => {
      if (!webcamActive) return;
      webcamRender();
      if (first && vid.videoWidth > 0) {
        first = false;
        if (typeof window.finishStep === 'function') {
          window.finishStep(1, 'webcam · live');
          window.finishStep(2, 'real-time color/luminance mapping');
          window.finishStep(3, 'live playback');
        }
        if (typeof window.setJobState === 'function') window.setJobState('success');
        const jobMeta = document.getElementById('job-meta');
        const footerText = document.getElementById('footer-text');
        if (jobMeta) jobMeta.textContent = 'webcam · live';
        if (footerText) footerText.textContent = '4 of 4 steps complete (webcam live)';
      }

      if ('requestVideoFrameCallback' in HTMLVideoElement.prototype) {
        vid.requestVideoFrameCallback(loop);
      } else {
        webcamRafId = requestAnimationFrame(loop);
      }
    };

    if ('requestVideoFrameCallback' in HTMLVideoElement.prototype) {
      vid.requestVideoFrameCallback(loop);
    } else {
      webcamRafId = requestAnimationFrame(loop);
    }

    // Add record button to playback bar if not present
    if (!document.getElementById('btn-webcam-rec')) {
      const recBtn = document.createElement('button');
      recBtn.id = 'btn-webcam-rec';
      recBtn.className = 'pb-btn';
      recBtn.style.cssText = 'font-size:11px;color:var(--red);white-space:nowrap;margin-right:8px;';
      recBtn.textContent = '⏺ Rec';
      const scrubBar = document.getElementById('playback-bar')?.querySelector('.scrub-bar');
      if (scrubBar) scrubBar.before(recBtn);
      recBtn.onclick = toggleWebcamRec;
    }
    const recEl = document.getElementById('btn-webcam-rec');
    if (recEl) recEl.style.display = '';
  }

  btnStopcam?.addEventListener('click', () => {
    webcamActive = false;
    if (webcamRafId) { cancelAnimationFrame(webcamRafId); webcamRafId = null; }
    if (webcamRecorder && webcamRecorder.state === 'recording') webcamRecorder.stop();
    if (webcamStream) {
      webcamStream.getTracks().forEach(t => t.stop());
      webcamStream = null;
    }
    vid.srcObject = null;
    vid.setAttribute('hidden', '');
    vid.style.cssText = '';

    btnWebcam?.classList.remove('hidden');
    btnStopcam?.classList.add('hidden');
    const rb = document.getElementById('btn-webcam-rec');
    if (rb) rb.style.display = 'none';
    if (asciiCanvas) asciiCanvas.hidden = true;
    document.getElementById('drop-hint')?.classList.remove('hidden');

    if (typeof window.resetSteps === 'function') window.resetSteps();
    if (typeof window.setJobState === 'function') window.setJobState('idle');
    const jobMeta = document.getElementById('job-meta');
    if (jobMeta) jobMeta.textContent = 'awaiting input';
  });

  function toggleWebcamRec() {
    const btn = document.getElementById('btn-webcam-rec');
    if (!webcamRecorder || webcamRecorder.state === 'inactive') {
      webcamChunks = [];
      const s = asciiCanvas.captureStream(state.exportFps || 15);
      if (webcamStream) {
        webcamStream.getAudioTracks().forEach(t => s.addTrack(t));
      }
      const mime = (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('video/webm;codecs=vp9'))
        ? 'video/webm;codecs=vp9'
        : 'video/webm';
      try {
        webcamRecorder = new MediaRecorder(s, { mimeType: mime, videoBitsPerSecond: 8_000_000 });
        webcamRecorder.ondataavailable = e => { if (e.data && e.data.size > 0) webcamChunks.push(e.data); };
        webcamRecorder.onstop = () => {
          if (webcamChunks.length && window.safeDownload) {
            window.safeDownload(new Blob(webcamChunks, { type: mime }), 'ascii-webcam.webm');
          }
        };
        webcamRecorder.start();
        if (btn) { btn.textContent = '⏹ Stop'; btn.style.color = 'var(--amber)'; }
      } catch (e) {
        console.error('Webcam recorder error:', e);
      }
    } else {
      webcamRecorder.stop();
      if (btn) { btn.textContent = '⏺ Rec'; btn.style.color = 'var(--red)'; }
    }
  }

  // Fullscreen
  function toggleFullscreen() {
    const pane = document.getElementById('ascii-pane');
    if (!pane) return;
    if (!document.fullscreenElement) {
      if (pane.requestFullscreen) pane.requestFullscreen();
      else if (pane.webkitRequestFullscreen) pane.webkitRequestFullscreen();
    } else {
      if (document.exitFullscreen) document.exitFullscreen();
      else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
    }
  }

  document.getElementById('ascii-pane')?.addEventListener('dblclick', toggleFullscreen);
  document.getElementById('btn-maximize')?.addEventListener('click', e => { e.preventDefault(); toggleFullscreen(); });
  document.getElementById('btn-fullscreen')?.addEventListener('click', e => { e.preventDefault(); toggleFullscreen(); });
  document.getElementById('btn-pb-fullscreen')?.addEventListener('click', e => { e.preventDefault(); toggleFullscreen(); });

  // Snapshot
  function takeSnapshot() {
    if (!asciiCanvas || asciiCanvas.width === 0 || asciiCanvas.height === 0) {
      alert('Nothing to capture yet. Please load a video or start webcam.');
      return;
    }
    const filename = `asciimotion-snapshot-${Date.now()}.png`;
    try {
      const dataURL = asciiCanvas.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = dataURL;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (err) {
      if (asciiCanvas.toBlob && window.safeDownload) {
        asciiCanvas.toBlob(b => { if (b) window.safeDownload(b, filename); }, 'image/png');
      }
    }
  }

  document.getElementById('btn-snapshot')?.addEventListener('click', e => { e.preventDefault(); takeSnapshot(); });
  document.getElementById('btn-pb-snapshot')?.addEventListener('click', e => { e.preventDefault(); takeSnapshot(); });

  // Keyboard Shortcuts Modal & Hotkeys
  const modalShortcuts = document.getElementById('modal-shortcuts');
  document.getElementById('btn-shortcuts')?.addEventListener('click', () => modalShortcuts?.classList.remove('hidden'));
  document.getElementById('close-shortcuts')?.addEventListener('click', () => modalShortcuts?.classList.add('hidden'));
  modalShortcuts?.addEventListener('click', e => { if (e.target === modalShortcuts) modalShortcuts.classList.add('hidden'); });

  document.addEventListener('keydown', e => {
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) return;
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    switch (e.code) {
      case 'Space':
        e.preventDefault();
        document.getElementById('btn-playpause')?.click();
        break;
      case 'ArrowLeft':
        if (webcamActive) break;
        e.preventDefault();
        if (state.liveActive) {
          vid.currentTime = Math.max(0, vid.currentTime - 5);
        } else if (state.exportedFrames && state.exportedFrames.length) {
          state.pbIndex = Math.max(0, state.pbIndex - Math.round((state.exportFps || 12) * 5));
          if (window.renderFrameToCanvas) window.renderFrameToCanvas(state.exportedFrames[state.pbIndex]);
        }
        break;
      case 'ArrowRight':
        if (webcamActive) break;
        e.preventDefault();
        if (state.liveActive) {
          vid.currentTime = Math.min(vid.duration || 0, vid.currentTime + 5);
        } else if (state.exportedFrames && state.exportedFrames.length) {
          state.pbIndex = Math.min(state.exportedFrames.length - 1, state.pbIndex + Math.round((state.exportFps || 12) * 5));
          if (window.renderFrameToCanvas) window.renderFrameToCanvas(state.exportedFrames[state.pbIndex]);
        }
        break;
      case 'ArrowUp':
        e.preventDefault();
        vid.volume = Math.min(1, vid.volume + 0.1);
        break;
      case 'ArrowDown':
        e.preventDefault();
        vid.volume = Math.max(0, vid.volume - 0.1);
        break;
      case 'KeyM':
        vid.muted = !vid.muted;
        break;
      case 'KeyF':
        e.preventDefault();
        toggleFullscreen();
        break;
      case 'Escape':
        if (document.fullscreenElement) {
          e.preventDefault();
          document.exitFullscreen();
        }
        break;
      case 'KeyS':
        e.preventDefault();
        takeSnapshot();
        break;
      case 'Slash':
        if (e.shiftKey) modalShortcuts?.classList.toggle('hidden');
        break;
    }
  });

  // Share / Embed modal
  const modalShare = document.getElementById('modal-share');
  document.getElementById('btn-share')?.addEventListener('click', () => {
    if (!state.exportedFrames || !state.exportedFrames.length) {
      const shareNote = document.getElementById('share-note');
      if (shareNote) shareNote.textContent = 'Run "Render ASCII video" first.';
      modalShare?.classList.remove('hidden');
      return;
    }
    const MAX = 180;
    const frames = state.exportedFrames.slice(0, MAX);
    const note = state.exportedFrames.length > MAX ? `Capped to ${MAX} frames for inline embed. ` : '';
    const html = buildEmbed(frames, state.exportFps, state.mode);
    const blobUrl = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    const snippetEl = document.getElementById('embed-snippet');
    if (snippetEl) {
      snippetEl.value = `<iframe src="${blobUrl}" width="100%" height="420" frameborder="0" title="AsciiMotion"></iframe>`;
    }
    const shareNote = document.getElementById('share-note');
    if (shareNote) shareNote.textContent = note + 'Click "Download standalone .html" for complete offline file.';
    modalShare?.classList.remove('hidden');
  });

  document.getElementById('close-share')?.addEventListener('click', () => modalShare?.classList.add('hidden'));
  modalShare?.addEventListener('click', e => { if (e.target === modalShare) modalShare?.classList.add('hidden'); });

  document.getElementById('btn-dl-embed')?.addEventListener('click', () => {
    if (!state.exportedFrames) return;
    const html = buildEmbed(state.exportedFrames, state.exportFps, state.mode);
    if (window.safeDownload) {
      window.safeDownload(new Blob([html], { type: 'text/html' }), 'ascii-motion-embed.html');
    }
  });

  document.getElementById('btn-copy-embed')?.addEventListener('click', () => {
    const ta = document.getElementById('embed-snippet');
    if (ta && ta.value) {
      ta.select();
      navigator.clipboard.writeText(ta.value).then(() => {
        const b = document.getElementById('btn-copy-embed');
        if (b) {
          b.textContent = '✓ Copied!';
          setTimeout(() => { b.textContent = 'Copy to clipboard'; }, 2000);
        }
      });
    }
  });

  function buildEmbed(frames, fps, mode) {
    const payload = JSON.stringify({
      fps: fps || 12,
      mode: mode || 'bw',
      frames: frames.map(f => ({
        t: f.text,
        c: mode === 'color' ? f.colors : null,
      })),
    });

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>AsciiMotion Embed</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#010409;color:#e6edf3;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;font-family:system-ui,-apple-system,sans-serif}
canvas{max-width:98vw;max-height:85vh;image-rendering:pixelated;border-radius:4px;box-shadow:0 8px 32px rgba(0,0,0,0.8)}
.ctrls{margin-top:12px;display:flex;align-items:center;gap:12px}
button{background:#161b22;color:#e6edf3;border:1px solid #30363d;border-radius:4px;padding:4px 12px;cursor:pointer;font-family:monospace;font-size:12px;transition:all .15s}
button:hover{border-color:#3fb950;color:#3fb950}
.brand{color:#8b949e;font-size:11px;font-family:monospace}
</style>
</head>
<body>
<canvas id="cv"></canvas>
<div class="ctrls">
  <button id="pp">⏸ Pause</button>
  <span class="brand">AsciiMotion</span>
</div>
<script>
const D = ${payload};
const cv = document.getElementById('cv');
const cx = cv.getContext('2d');
const FONT_PX = 9, LINE_H = 10, CHAR_W = 5.4;
let idx = 0, playing = true;
const fr = D.frames, fps = D.fps, mode = D.mode;

if (fr.length) {
  cv.width = Math.ceil(fr[0].t[0].length * CHAR_W);
  cv.height = fr[0].t.length * LINE_H;
}

function draw() {
  if (!fr.length) return;
  const f = fr[idx];
  cx.fillStyle = '#010409';
  cx.fillRect(0, 0, cv.width, cv.height);
  cx.font = FONT_PX + "px 'JetBrains Mono', 'Consolas', monospace";
  cx.textBaseline = 'top';

  if (mode === 'color' && f.c) {
    for (let r = 0; r < f.t.length; r++) {
      const rowT = f.t[r];
      const rowC = f.c[r];
      if (!rowC) continue;
      let startCol = 0;
      let curC = rowC[0];
      let b = '';
      for (let c = 0; c < rowT.length; c++) {
        const color = rowC[c];
        if (color === curC) {
          b += rowT[c];
        } else {
          cx.fillStyle = curC;
          cx.fillText(b, Math.round(startCol * CHAR_W), r * LINE_H);
          curC = color;
          b = rowT[c];
          startCol = c;
        }
      }
      if (b) {
        cx.fillStyle = curC;
        cx.fillText(b, Math.round(startCol * CHAR_W), r * LINE_H);
      }
    }
  } else {
    cx.fillStyle = '#3fb950';
    for (let r = 0; r < f.t.length; r++) {
      cx.fillText(f.t[r], 0, r * LINE_H);
    }
  }
}

draw();
setInterval(() => {
  if (!playing || !fr.length) return;
  idx = (idx + 1) % fr.length;
  draw();
}, Math.round(1000 / fps));

document.getElementById('pp').onclick = function() {
  playing = !playing;
  this.textContent = playing ? '⏸ Pause' : '▶ Play';
};
<\/script>
</body>
</html>`;
  }
})();
