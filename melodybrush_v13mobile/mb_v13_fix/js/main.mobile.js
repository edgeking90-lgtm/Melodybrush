/* 모바일 미니맵 크기 */
MM_W = 110; MM_H = 56;

cv  = document.getElementById('paper');
ctx = cv.getContext('2d');
wrap = document.getElementById('canvas-wrap');

window.addEventListener('resize', resize);

/* Undo */
function snapshot() { _history.push(JSON.parse(JSON.stringify(_layer.strokes))); if (_history.length > 60) _history.shift(); }
function undo() { if (!_history.length) return; _layer.strokes = _history.pop(); render(); flashHint('되돌리기'); }

/* ════════════════════════════════
   터치 / 포인터 입력
   - pointerType === 'pen': 스타일러스 → 드로잉 우선
   - pointerType === 'touch': 손가락
     - Edit 모드: 1포인터 드로잉, 2포인터 핀치줌/패닝
     - 다른 모드: 1포인터 패닝, 2포인터 핀치줌
════════════════════════════════ */

const _activePointers = new Map(); // pointerId → {x, y}
let _pinchStartDist = 0, _pinchStartVP = null, _pinchCenterX = 0, _pinchCenterY = 0;
let _panStartX = 0, _panStartY = 0, _panStartVP = null;
let _isPinching = false;

function getPointerPos(e) {
  const r = cv.getBoundingClientRect();
  return {x: e.clientX - r.left, y: e.clientY - r.top};
}

cv.addEventListener('pointerdown', e => {
  e.preventDefault();
  cv.setPointerCapture(e.pointerId);
  const pos = getPointerPos(e);
  _activePointers.set(e.pointerId, pos);

  const count = _activePointers.size;
  const isPen = e.pointerType === 'pen';

  if (count === 1) {
    _isPinching = false;
    const {x, y} = pos;
    const ms = xt(x), cents = clamp(yl(y), -3600, 3600);

    if (isPen || appMode === 'edit') {
      // 스타일러스 또는 Edit 모드: 드로잉
      if (drawTool === 'draw') {
        ensureAudio();
        if (_playing) stopPlay();
        snapshot();
        _drawing = {pts: [{time: ms, pitch: cents}], blot: 0};
        liveStart(cents);
        _holdStart = performance.now(); _holdAnchor = {x, y}; _holdMoved = false;
        startHoldWatch();
        render();
      } else {
        // catch tool
        const found = _findNearestPt(ms, cents);
        if (found) {
          ensureAudio();
          snapshot(); _catchPoint = found;
          _catchOrigPts = JSON.parse(JSON.stringify(_layer.strokes[found.strokeIdx].pts));
          _catchOrigCents = found.cents; _catchTargetCents = found.cents; _catchCurCents = found.cents;
          _catchDragging = true; liveStart(found.cents); startCatchLoop();
        }
      }
    } else {
      // View/Note/Wire 모드, 손가락 1개: 패닝 시작
      _panStartX = x; _panStartY = y;
      _panStartVP = {...VP};
    }
  } else if (count === 2) {
    // 2포인터: 핀치 줌 시작
    _isPinching = true;
    _drawing = null; // 드로잉 취소
    cancelAnimationFrame(_holdRAF); liveStop();
    const pts = [..._activePointers.values()];
    _pinchStartDist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
    _pinchCenterX = (pts[0].x + pts[1].x) / 2;
    _pinchCenterY = (pts[0].y + pts[1].y) / 2;
    _pinchStartVP = {...VP};
    _panStartVP = {...VP};
    _panStartX = _pinchCenterX;
    _panStartY = _pinchCenterY;
  }
}, {passive: false});

cv.addEventListener('pointermove', e => {
  e.preventDefault();
  if (!_activePointers.has(e.pointerId)) return;
  const pos = getPointerPos(e);
  _activePointers.set(e.pointerId, pos);

  const count = _activePointers.size;
  const isPen = e.pointerType === 'pen';
  const {x, y} = pos;
  const ms = xt(x), cents = clamp(yl(y), -3600, 3600);

  if (count === 2 && _isPinching) {
    // 핀치 줌 + 투포인터 패닝
    const pts = [..._activePointers.values()];
    const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
    const cx = (pts[0].x + pts[1].x) / 2, cy = (pts[0].y + pts[1].y) / 2;
    const scale = _pinchStartDist > 0 ? dist / _pinchStartDist : 1;
    // 핀치 시작점 VP 기준으로 줌 + 패닝 한번에 적용
    VP = {..._pinchStartVP};
    vpZoomAt(_pinchCenterX, _pinchCenterY, 1 / scale);
    // 핀치 중심 이동에 따른 패닝
    const ddx = cx - _pinchCenterX, ddy = cy - _pinchCenterY;
    vpPanBy(-ddx, -ddy);
    refreshLegend(); render();
    return;
  }

  if (count === 1 && !_isPinching) {
    if ((isPen || appMode === 'edit') && drawTool === 'draw' && _drawing) {
      if (_holdAnchor) {
        const d = Math.hypot(x - _holdAnchor.x, y - _holdAnchor.y);
        if (d > 6) { _holdMoved = true; _drawing.blot = 0; }
      }
      const pts = _drawing.pts, last = pts[pts.length - 1];
      if (ms - last.time >= 4) { pts.push({time: ms, pitch: cents}); liveUpdate(cents); render(); }
    } else if ((isPen || appMode === 'edit') && drawTool === 'catch' && _catchDragging) {
      _catchTargetCents = cents;
    } else if (!isPen && appMode !== 'edit' && _panStartVP) {
      const dx = x - _panStartX, dy = y - _panStartY;
      VP = {..._panStartVP};
      vpPanBy(-dx, -dy);
      refreshLegend(); render();
    }
  }
}, {passive: false});

cv.addEventListener('pointerup', e => {
  e.preventDefault();
  const pos = getPointerPos(e);
  const isPen = e.pointerType === 'pen';

  if ((isPen || appMode === 'edit') && drawTool === 'draw' && _drawing) {
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
  if ((isPen || appMode === 'edit') && drawTool === 'catch' && _catchDragging) {
    _catchDragging = false;
  }
  _activePointers.delete(e.pointerId);
  if (_activePointers.size < 2) {
    _isPinching = false;
    // 남은 포인터로 패닝 재시작
    if (_activePointers.size === 1 && appMode !== 'edit') {
      const remaining = [..._activePointers.values()][0];
      _panStartX = remaining.x; _panStartY = remaining.y; _panStartVP = {...VP};
    }
  }
}, {passive: false});

cv.addEventListener('pointercancel', e => {
  _activePointers.delete(e.pointerId);
  if (_drawing) { liveStop(); _drawing = null; render(); }
  cancelAnimationFrame(_holdRAF);
  if (_activePointers.size < 2) _isPinching = false;
});

/* 드래그앤드롭 (파일) */
wrap.addEventListener('dragover', e => { e.preventDefault(); document.getElementById('drop-overlay').classList.add('show'); });
wrap.addEventListener('dragleave', () => document.getElementById('drop-overlay').classList.remove('show'));
wrap.addEventListener('drop', async e => {
  e.preventDefault(); document.getElementById('drop-overlay').classList.remove('show');
  const file = [...e.dataTransfer.files].find(f => /\.midi?$/i.test(f.name));
  if (!file) { flashHint('MIDI 파일(.mid/.midi)을 놓아주세요'); return; }
  try {
    const buf = await file.arrayBuffer();
    const raw = parseMidi(buf);
    const totalNotes = raw.reduce((s, tr) => s + tr.notes.length, 0);
    midiTracks = raw; rawMidiTracks = raw; allCells = []; hfResult = []; exprEvents = [];
    midiLines = buildLines(midiTracks);
    const totalDur = midiTracks.flatMap(tr => tr.notes.map(n => n.endMs)).reduce((a, b) => a > b ? a : b, 0);
    autoFitVP(midiTracks.flatMap(tr => tr.notes), totalDur);
    _mmTotalMs = totalDur;
    renderLayerPanel();
    document.getElementById('drop-hint').classList.add('hidden');
    document.getElementById('btn-export').disabled = false;
    setStatus(`${totalNotes}음 / ${midiLines.length}선 / ${detectedBpm}BPM`);
    log(`드롭: ${file.name} — ${totalNotes}음`);
    setAppMode('view');
  } catch (err) { log('오류: ' + err.message); }
});

/* 미니맵 탭 */
(function() {
  const mw = document.getElementById('minimap-wrap');
  function seek(e) {
    e.stopPropagation();
    const r = mw.getBoundingClientRect();
    const cx = e.clientX - r.left, cy = e.clientY - r.top;
    const fT1 = Math.max(_mmTotalMs * 1.06, 10000);
    let fP0 = -1800, fP1 = 1800;
    if (midiLines.length) {
      let lo = Infinity, hi = -Infinity;
      midiLines.forEach(l => l.notes.forEach(n => { const c = midiToCents(n.midi); if (c < lo) lo = c; if (c > hi) hi = c; }));
      const pad = (hi - lo) * 0.30; fP0 = lo - pad; fP1 = hi + pad;
      if (fP1 - fP0 < 300) { const m = (fP0 + fP1) / 2; fP0 = m - 150; fP1 = m + 150; }
    }
    const tC = cx / MM_W * fT1, pC = fP0 + (1 - cy / MM_H) * (fP1 - fP0);
    const tH = (VP.t1 - VP.t0) / 2, pH = (VP.p1 - VP.p0) / 2;
    VP.t0 = tC - tH; VP.t1 = tC + tH; VP.p0 = pC - pH; VP.p1 = pC + pH;
    render();
  }
  mw.addEventListener('pointerdown', seek);
  mw.addEventListener('pointermove', e => { if (e.buttons) seek(e); });
})();

/* Hold Watch */
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
  return bestD < 60 ? best : null; // 터치용으로 히트 영역 확장
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

/* 초기화 */
resize();
setAppMode('view');
log('Melody Brush Mobile 준비.');