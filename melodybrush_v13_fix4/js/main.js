/* PC 미니맵 크기 */
MM_W = 280; MM_H = 140;

/* ════════════════════════════════════════════════════════════
   캔버스 / 래퍼 초기화
════════════════════════════════════════════════════════════ */
cv  = document.getElementById('paper');
ctx = cv.getContext('2d');
wrap = document.getElementById('paper-wrap');
console.log('[MB] main.js 초기화 — cv:', !!cv, '/ ctx:', !!ctx, '/ wrap:', !!wrap);

/* ════════════════════════════════════════════════════════════
   리사이즈
════════════════════════════════════════════════════════════ */
window.addEventListener('resize', resize);

/* ════════════════════════════════════════════════════════════
   Undo
════════════════════════════════════════════════════════════ */
function snapshot() { _history.push(JSON.parse(JSON.stringify(_layer.strokes))); if (_history.length > 60) _history.shift(); }
function undo() { if (!_history.length) return; _layer.strokes = _history.pop(); render(); flashHint('되돌리기'); }

/* ════════════════════════════════════════════════════════════
   마우스 입력
════════════════════════════════════════════════════════════ */
let _panStart = null;

function getCanvasPos(e) {
  const r = cv.getBoundingClientRect();
  return {x: e.clientX - r.left, y: e.clientY - r.top};
}

cv.addEventListener('mousedown', e => {
  if (e.button !== 0) return;
  e.preventDefault();
  ensureAudio();
  const {x, y} = getCanvasPos(e);
  const ms = xt(x), cents = clamp(yl(y), -3600, 3600);
  if (appMode === 'edit') {
    if (drawTool === 'draw') {
      if (_playing) stopPlay();
      snapshot(); _drawing = {pts: [{time: ms, pitch: cents}], blot: 0};
      liveStart(cents);
      _holdStart = performance.now(); _holdAnchor = {x, y}; _holdMoved = false;
      startHoldWatch(); render();
    } else {
      const found = _findNearestPt(ms, cents);
      if (found) {
        snapshot(); _catchPoint = found;
        _catchOrigPts = JSON.parse(JSON.stringify(_layer.strokes[found.strokeIdx].pts));
        _catchOrigCents = found.cents; _catchTargetCents = found.cents; _catchCurCents = found.cents;
        _catchDragging = true; liveStart(found.cents); startCatchLoop();
      }
    }
  } else if (appMode === 'wire' && wireMerged) {
    const hit = wireHitTest(x, y);
    if (hit) { _wireDrag = hit; ensureAudio(); liveStart(hit.pt.cents); }
    else { wrap.classList.add('grabbing'); _panStart = {x, y, vp: {...VP}}; }
  } else {
    wrap.classList.add('grabbing');
    _panStart = {x, y, vp: {...VP}};
  }
});

cv.addEventListener('mousemove', e => {
  const {x, y} = getCanvasPos(e);
  const ms = xt(x), cents = clamp(yl(y), -3600, 3600);
  if (appMode === 'edit') {
    if (drawTool === 'draw' && _drawing && e.buttons === 1) {
      if (_holdAnchor) { const d = Math.hypot(x - _holdAnchor.x, y - _holdAnchor.y); if (d > 4) { _holdMoved = true; _drawing.blot = 0; } }
      const pts = _drawing.pts, last = pts[pts.length - 1];
      if (ms - last.time >= 6) { pts.push({time: ms, pitch: cents}); liveUpdate(cents); render(); }
    } else if (drawTool === 'catch' && _catchDragging) { _catchTargetCents = cents; }
  } else if (appMode === 'wire' && _wireDrag && e.buttons === 1) {
    const newCents = clamp(yl(y), -3600, 3600);
    applyWireDrag(_wireDrag.wl, _wireDrag.pt, newCents);
    liveUpdate(newCents); render();
  } else if (_panStart && e.buttons === 1) {
    const dx = x - _panStart.x, dy = y - _panStart.y;
    VP = {..._panStart.vp}; vpPanBy(-dx, -dy);
    refreshLegend(); render();
  }
});

cv.addEventListener('mouseup', e => {
  if (e.button !== 0) return;
  wrap.classList.remove('grabbing');
  if (appMode === 'edit') {
    if (drawTool === 'draw' && _drawing) {
      cancelAnimationFrame(_holdRAF); _holdAnchor = null; liveStop();
      const s = _drawing; _drawing = null;
      if (s.pts.length === 1) {
        const p = s.pts[0];
        s.pts = [{time: p.time, pitch: p.pitch}, {time: p.time + 180, pitch: p.pitch}];
        s.blotRadius = s.blot > 1 ? s.blot : 0;
        playDot(p.pitch);
      }
      if (s.pts.length >= 2) _layer.strokes.push(s); render();
    }
    if (drawTool === 'catch' && _catchDragging) { _catchDragging = false; }
  } else if (appMode === 'wire' && _wireDrag) {
    liveStop(); _wireDrag = null; render();
  } else { _panStart = null; }
});

cv.addEventListener('mouseleave', e => {
  wrap.classList.remove('grabbing');
  if (appMode === 'edit' && _drawing) {
    cancelAnimationFrame(_holdRAF); liveStop();
    const s = _drawing; _drawing = null;
    if (s.pts.length >= 2) _layer.strokes.push(s); render();
  }
  _panStart = null;
});

cv.addEventListener('wheel', e => {
  e.preventDefault();
  const {x, y} = getCanvasPos(e);
  vpZoomAt(x, y, e.deltaY > 0 ? 1.10 : 0.91);
  refreshLegend(); render();
}, {passive: false});

/* ════════════════════════════════════════════════════════════
   드래그앤드롭
════════════════════════════════════════════════════════════ */
wrap.addEventListener('dragover', e => { e.preventDefault(); document.getElementById('drop-overlay').classList.add('show'); });
wrap.addEventListener('dragleave', () => document.getElementById('drop-overlay').classList.remove('show'));
wrap.addEventListener('drop', async e => {
  e.preventDefault(); document.getElementById('drop-overlay').classList.remove('show');
  const file = [...e.dataTransfer.files].find(f => /\.midi?$/i.test(f.name));
  if (!file) { flashHint('MIDI 파일(.mid/.midi)을 놓아주세요'); return; }
  try { log(`드롭: ${file.name}`); const buf = await file.arrayBuffer(); const raw = parseMidi(buf); log(`파싱: ${raw.length}개 Track/Ch, BPM=${detectedBpm}`); await runPipeline(raw); }
  catch (err) { console.error(err); log('오류: ' + err.message); hideProgress(); }
});

/* ════════════════════════════════════════════════════════════
   Hold Watch / Catch
════════════════════════════════════════════════════════════ */
function startHoldWatch() {
  cancelAnimationFrame(_holdRAF);
  function step() {
    if (!_drawing) return;
    const el = performance.now() - _holdStart;
    if (!_holdMoved && el > HOLD_DELAY) {
      _drawing.blot = Math.min(HOLD_MAX_R, (el - HOLD_DELAY) * HOLD_GROW);
      render();
    }
    _holdRAF = requestAnimationFrame(step);
  }
  _holdRAF = requestAnimationFrame(step);
}

function _findNearestPt(ms, cents) {
  let best = null, bestD = Infinity;
  for (let si = 0; si < _layer.strokes.length; si++) {
    const pts = _layer.strokes[si].pts;
    for (let pi = 0; pi < pts.length; pi++) {
      const p = pts[pi], dx = tx(p.time) - tx(ms), dy = ly(p.pitch) - ly(cents), d = Math.sqrt(dx * dx + dy * dy);
      if (d < bestD) { bestD = d; best = {strokeIdx: si, ptIdx: pi, ms: p.time, cents: p.pitch}; }
    }
  }
  return bestD < 50 ? best : null;
}
function applyPullFresh(curCents) {
  if (!_catchPoint || !_catchOrigPts) return;
  const pts = _layer.strokes[_catchPoint.strokeIdx].pts;
  const anchorTime = _catchPoint.ms, dcents = curCents - _catchOrigCents;
  for (let i = 0; i < pts.length; i++) {
    const orig = _catchOrigPts[i], dt = Math.abs(orig.time - anchorTime), falloff = Math.max(0, 1 - dt / PULL_FALLOFF_MS);
    pts[i].pitch = clamp(orig.pitch + dcents * falloff, -3600, 3600);
  }
}
function startCatchLoop() {
  cancelAnimationFrame(_catchRAF);
  function step() {
    if (!_catchPoint) return;
    const diff = _catchTargetCents - _catchCurCents; _catchCurCents += diff * 0.22;
    applyPullFresh(_catchCurCents); liveUpdate(_catchCurCents); render();
    if (!_catchDragging && Math.abs(_catchTargetCents - _catchCurCents) < 0.6) { finalizeCatch(); return; }
    _catchRAF = requestAnimationFrame(step);
  }
  _catchRAF = requestAnimationFrame(step);
}
function finalizeCatch() { cancelAnimationFrame(_catchRAF); liveStop(); _catchPoint = null; _catchOrigPts = null; render(); }

/* ════════════════════════════════════════════════════════════
   미니맵 클릭 탐색
════════════════════════════════════════════════════════════ */
(function () {
  const mw = document.getElementById('minimap-wrap');
  function seek(e) {
    e.stopPropagation();
    const r = mw.getBoundingClientRect();
    const cx = (e.clientX) - r.left, cy = (e.clientY) - r.top;
    const fT1 = Math.max(_mmTotalMs * 1.06, 10000);
    let fP0 = -1800, fP1 = 1800;
    if (midiLines.length) {
      let lo = Infinity, hi = -Infinity;
      midiLines.forEach(l => l.notes.forEach(n => { const c = midiToCents(n.midi); if (c < lo) lo = c; if (c > hi) hi = c; }));
      const pad = (hi - lo) * 0.30; fP0 = lo - pad; fP1 = hi + pad;
      if (fP1 - fP0 < 300) { const m = (fP0 + fP1) / 2; fP0 = m - 150; fP1 = m + 150; }
    }
    const tC = cx / 140 * fT1, pC = fP0 + (1 - cy / 70) * (fP1 - fP0);
    const tH = (VP.t1 - VP.t0) / 2, pH = (VP.p1 - VP.p0) / 2;
    VP.t0 = tC - tH; VP.t1 = tC + tH; VP.p0 = pC - pH; VP.p1 = pC + pH;
    render();
  }
  mw.addEventListener('mousedown', seek);
  mw.addEventListener('mousemove', e => { if (e.buttons) seek(e); });
})();

/* ════════════════════════════════════════════════════════════
   키보드 단축키
════════════════════════════════════════════════════════════ */
document.addEventListener('keydown', e => {
  const tag = document.activeElement.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;
  switch (e.key) {
    case ' ': e.preventDefault(); togglePlay(); break;
    case 'z': case 'Z': if (e.ctrlKey || e.metaKey) { e.preventDefault(); undo(); } break;
    case 'v': case 'V': setAppMode('view'); break;
    case 'n': case 'N': setAppMode('note'); break;
    case 'e': case 'E': setAppMode('edit'); break;
    case 'w': case 'W': setAppMode('wire'); break;
    case 'd': case 'D': if (appMode === 'edit') setTool('draw'); break;
    case 'c': case 'C': if (appMode === 'edit') setTool('catch'); break;
    case 'ArrowLeft': vpPanBy(-CW * 0.12, 0); render(); break;
    case 'ArrowRight': vpPanBy(CW * 0.12, 0); render(); break;
    case 'ArrowUp': vpPanBy(0, -CH * 0.12); render(); break;
    case 'ArrowDown': vpPanBy(0, CH * 0.12); render(); break;
    case '+': case '=': vpZoomAt(CW / 2, CH / 2, 0.82); refreshLegend(); render(); break;
    case '-': vpZoomAt(CW / 2, CH / 2, 1.22); refreshLegend(); render(); break;
  }
});

/* ════════════════════════════════════════════════════════════
   초기화
════════════════════════════════════════════════════════════ */
resize();
setAppMode('view');
log('Melody Brush PC 준비. MIDI를 드래그앤드롭하거나 입력 탭에서 불러오세요.');
