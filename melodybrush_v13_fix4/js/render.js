let _texCanvas = null;
function buildTexture() {
  const t = document.createElement('canvas');
  t.width = Math.max(1, Math.round(CW)); t.height = Math.max(1, Math.round(CH));
  const tc = t.getContext('2d');
  const n = Math.round(CW * CH * 0.00032);
  for (let i = 0; i < n; i++) {
    const x = Math.random() * CW, y = Math.random() * CH, sh = Math.random() < 0.5 ? 0 : 255;
    tc.fillStyle = `rgba(${sh},${sh},${sh},${(0.01 + Math.random() * 0.016).toFixed(3)})`;
    const w = 0.5 + Math.random() * 1.1; tc.fillRect(x, y, w, w);
  }
  _texCanvas = t;
}
function resize() {
  DPR = window.devicePixelRatio || 1;
  CW = window.innerWidth; CH = window.innerHeight;
  cv.width = CW * DPR; cv.height = CH * DPR;
  cv.style.width = CW + 'px'; cv.style.height = CH + 'px';
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  buildTexture(); render();
}
function hexToRgba(hex, a) {
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${a})`;
}
function drawWireLayer() {
  if (!wireLayer) return;
  ctx.save(); ctx.beginPath(); ctx.rect(-20, -20, CW + 40, CH + 40); ctx.clip();
  wireLayer.lines.forEach(wl => {
    const line = midiLines.find(l => l.id === wl.lineId);
    const w = line ? 16 : 16;
    const pts = wl.pts; if (pts.length < 2) return;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.strokeStyle = `rgba(20,15,5,${0.92 * 0.16})`; ctx.lineWidth = w + 3; _drawCatmullRom(pts); ctx.stroke();
    ctx.strokeStyle = hexToRgba(wireColor, 0.92); ctx.lineWidth = w; _drawCatmullRom(pts); ctx.stroke();
  });
  ctx.restore();
}
function drawSmoothCoreline(pts, col, lineW, alpha) {
  if (pts.length < 2) return;
  ctx.save();
  ctx.beginPath(); ctx.rect(-20, -20, CW + 40, CH + 40); ctx.clip();
  ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.globalAlpha = alpha;
  ctx.strokeStyle = hexToRgba(col, 0.18); ctx.lineWidth = lineW + 8;
  if (pts.length >= 3) _drawCatmullRom(pts);
  else { ctx.beginPath(); ctx.moveTo(tx(pts[0].t), ly(pts[0].cents)); for (let i = 1; i < pts.length; i++) ctx.lineTo(tx(pts[i].t), ly(pts[i].cents)); }
  ctx.stroke();
  ctx.strokeStyle = hexToRgba(col, 0.90); ctx.lineWidth = lineW;
  if (pts.length >= 3) _drawCatmullRom(pts);
  else { ctx.beginPath(); ctx.moveTo(tx(pts[0].t), ly(pts[0].cents)); for (let i = 1; i < pts.length; i++) ctx.lineTo(tx(pts[i].t), ly(pts[i].cents)); }
  ctx.stroke();
  pts.forEach(p => {
    const cx2 = tx(p.t), cy2 = ly(p.cents);
    if (cx2 < -8 || cx2 > CW + 8 || cy2 < -8 || cy2 > CH + 8) return;
    ctx.beginPath(); ctx.arc(cx2, cy2, 2.5 + (p.energy || 0.5) * 2, 0, Math.PI * 2);
    ctx.fillStyle = hexToRgba(col, 0.85); ctx.fill();
  });
  ctx.globalAlpha = 1; ctx.restore();
}
function _drawCatmullRom(pts) {
  ctx.beginPath(); const n = pts.length;
  ctx.moveTo(tx(pts[0].t), ly(pts[0].cents));
  for (let i = 0; i < n - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(n - 1, i + 2)];
    const x0 = tx(p0.t), y0 = ly(p0.cents), x1 = tx(p1.t), y1 = ly(p1.cents), x2 = tx(p2.t), y2 = ly(p2.cents), x3 = tx(p3.t), y3 = ly(p3.cents);
    const cp1x = x1 + (x2 - x0) / 6, cp1y = y1 + (y2 - y0) / 6, cp2x = x2 - (x3 - x1) / 6, cp2y = y2 - (y3 - y1) / 6;
    ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, x2, y2);
  }
}
function drawFiberGesture(line, alpha) {
  const lod = getLOD();
  line.fibers.forEach((fiber, fi) => {
    const pts = fiber.points; if (pts.length < 2) return;
    ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.globalAlpha = alpha;
    if (lod === 1) {
      ctx.beginPath(); ctx.moveTo(tx(pts[0].t), ly(pts[0].cents));
      for (let i = 1; i < pts.length; i++) ctx.lineTo(tx(pts[i].t), ly(pts[i].cents));
      ctx.strokeStyle = hexToRgba(line.color, 0.28); ctx.lineWidth = 2; ctx.stroke();
    } else {
      for (let i = 1; i < pts.length; i++) {
        const col = GESTURE_COL[pts[i].gesture] || '#888';
        ctx.beginPath(); ctx.moveTo(tx(pts[i - 1].t), ly(pts[i - 1].cents)); ctx.lineTo(tx(pts[i].t), ly(pts[i].cents));
        ctx.strokeStyle = hexToRgba(col, 0.75); ctx.lineWidth = 2.5; ctx.stroke();
      }
    }
    ctx.globalAlpha = 1; ctx.restore();
  });
}
function drawCellDots(line, alpha) {
  ctx.save();
  line.fibers.forEach(fiber => {
    fiber.cells.forEach(cell => {
      const cx = tx((cell.t0 + cell.t1) / 2), cy = ly(midiToCents(cell.pitch));
      if (cx < -8 || cx > CW + 8 || cy < -8 || cy > CH + 8) return;
      const col = GESTURE_COL[cell.gesture] || '#888';
      ctx.beginPath(); ctx.arc(cx, cy, 2 + cell.energy * 3, 0, Math.PI * 2);
      ctx.fillStyle = hexToRgba(col, 0.5 * cell.energy * alpha); ctx.fill();
    });
  });
  ctx.restore();
}
function buildBrushPath(pts) {
  const n = pts.length, w = new Array(n).fill(3.4);
  for (let i = 0; i < n; i++) {
    let speed = i === 0 ? (n > 1 ? dist2(pts, 0, 1) / Math.max(1, pts[1].time - pts[0].time) : 0.2) : dist2(pts, i - 1, i) / Math.max(1, pts[i].time - pts[i - 1].time);
    let ww = Math.max(2.1, Math.min(4.6, 3.5 - (speed - 0.25) * 1.6));
    const u = n > 1 ? i / (n - 1) : 0.5;
    let taper = 1; if (u < 0.12) taper = 0.45 + 0.55 * (u / 0.12); else if (u > 0.88) taper = 0.45 + 0.55 * ((1 - u) / 0.12);
    w[i] = ww * taper;
  }
  const P = pts.map(p => ({x: tx(p.time), y: ly(p.pitch)}));
  if (n < 3) return P.map((p, i) => ({x: p.x, y: p.y, w: w[i] || 3}));
  const out = []; out.push({x: P[0].x, y: P[0].y, w: w[0]});
  for (let i = 0; i < P.length - 1; i++) {
    const p0 = P[i - 1] || P[i], p1 = P[i], p2 = P[i + 1], p3 = P[i + 2] || p2;
    for (let t = 0.2; t <= 1.0001; t += 0.2) {
      const tt = Math.min(t, 1), t2 = tt * tt, t3 = t2 * tt;
      const x = 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * tt + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3);
      const y = 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * tt + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3);
      out.push({x, y, w: w[i] + (w[i + 1] - w[i]) * tt});
    }
  }
  return out;
}
function dist2(pts, i, j) { return Math.hypot(tx(pts[j].time) - tx(pts[i].time), ly(pts[j].pitch) - ly(pts[i].pitch)); }
function drawBrushStroke(pts, isLive) {
  if (pts.length < 2) return;
  const path = buildBrushPath(pts); ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.strokeStyle = isLive ? 'rgba(36,31,24,0.15)' : 'rgba(36,31,24,0.12)';
  for (let i = 1; i < path.length; i++) { ctx.lineWidth = (path[i - 1].w + path[i].w) / 2 + 5; ctx.beginPath(); ctx.moveTo(path[i - 1].x, path[i - 1].y); ctx.lineTo(path[i].x, path[i].y); ctx.stroke(); }
  ctx.strokeStyle = isLive ? 'rgba(28,23,17,0.92)' : 'rgba(20,16,11,0.95)';
  for (let i = 1; i < path.length; i++) { ctx.lineWidth = (path[i - 1].w + path[i].w) / 2; ctx.beginPath(); ctx.moveTo(path[i - 1].x, path[i - 1].y); ctx.lineTo(path[i].x, path[i].y); ctx.stroke(); }
  ctx.restore();
}
function drawBlot(p, r, a) {
  if (r <= 1) return; const x = tx(p.time), y = ly(p.pitch); ctx.save();
  const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
  grad.addColorStop(0, `rgba(18,14,10,${0.5 * a})`); grad.addColorStop(0.6, `rgba(18,14,10,${0.22 * a})`); grad.addColorStop(1, 'rgba(18,14,10,0)');
  ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); ctx.restore();
}
function render() {
  if (!ctx || !cv || CW === 0 || CH === 0) return;
  ctx.clearRect(0, 0, CW, CH);
  if (_texCanvas) ctx.drawImage(_texCanvas, 0, 0, CW, CH);
  if (midiLines.length) {
    const lod = getLOD();
    const coreW = lod === 0 ? 5 : lod === 1 ? 4 : 3;
    midiLines.forEach(l => {
      if (hiddenTracks.has(String(l.trackIdx))) return;
      const isSel = selectedLine === l, dimmed = selectedLine && !isSel, baseA = dimmed ? 0.15 : 1.0;
      if (appMode === 'view') {
        drawSmoothCoreline(l.smoothCoreline, l.color, coreW + (isSel ? 1.5 : 0), baseA * (isSel ? 1.0 : 0.82));
      } else if (appMode === 'note') {
        if (lod >= 1) drawFiberGesture(l, baseA * (lod === 1 ? 0.4 : 0.65));
        if (lod === 2) drawCellDots(l, baseA * 0.6);
        drawSmoothCoreline(l.smoothCoreline, l.color, coreW + (isSel ? 1.5 : 0), baseA * (lod === 2 ? 0.52 : 0.82));
      } else {
        drawSmoothCoreline(l.smoothCoreline, l.color, coreW, baseA * 0.45);
      }
    });
    const badge = document.getElementById('lod-badge');
    badge.textContent = '× ' + ['전체', '중간', '근접'][lod]; badge.style.display = 'block';
    refreshLegend();
  }
  for (const s of _layer.strokes) { drawBrushStroke(s.pts, false); if (s.blotRadius) drawBlot(s.pts[0], s.blotRadius, 1); }
  if (_drawing) { drawBrushStroke(_drawing.pts, true); if (_drawing.blot) drawBlot(_drawing.pts[0], _drawing.blot, 0.85); }
  if (wireLayer) drawWireLayer();
  updateMinimap();
}
function updateMinimap() {
  const mw = document.getElementById('minimap-wrap');
  if (!midiLines.length && !_layer.strokes.length) { mw.style.display = 'none'; return; }
  mw.style.display = 'block';
  const mc = document.getElementById('minimap-canvas'), mx = mc.getContext('2d');
  mx.clearRect(0, 0, MM_W, MM_H);
  const fT1 = Math.max(_mmTotalMs * 1.06, 10000);
  let fP0 = -1800, fP1 = 1800;
  if (midiLines.length) {
    let lo = Infinity, hi = -Infinity;
    midiLines.forEach(l => l.notes.forEach(n => { const c = midiToCents(n.midi); if (c < lo) lo = c; if (c > hi) hi = c; }));
    const pad = (hi - lo) * 0.30; fP0 = lo - pad; fP1 = hi + pad;
    if (fP1 - fP0 < 300) { const m = (fP0 + fP1) / 2; fP0 = m - 150; fP1 = m + 150; }
  }
  const mmX = t => (t / fT1) * MM_W;
  const mmY = p => MM_H * (1 - (p - fP0) / (fP1 - fP0));
  midiLines.forEach(l => {
    const pts = l.smoothCoreline; if (pts.length < 2) return;
    mx.beginPath(); mx.moveTo(mmX(pts[0].t), mmY(pts[0].cents));
    for (let i = 1; i < pts.length; i++) mx.lineTo(mmX(pts[i].t), mmY(pts[i].cents));
    mx.strokeStyle = l.color; mx.lineWidth = 1.8; mx.globalAlpha = 0.85; mx.stroke(); mx.globalAlpha = 1;
  });
  _layer.strokes.forEach(s => {
    if (s.pts.length < 2) return;
    mx.beginPath(); mx.moveTo(mmX(s.pts[0].time), mmY(s.pts[0].pitch));
    for (let i = 1; i < s.pts.length; i++) mx.lineTo(mmX(s.pts[i].time), mmY(s.pts[i].pitch));
    mx.strokeStyle = '#2a2620'; mx.lineWidth = 1; mx.globalAlpha = 0.5; mx.stroke(); mx.globalAlpha = 1;
  });
  const vEl = document.getElementById('minimap-vp');
  const vx = mmX(VP.t0) / MM_W * MM_W, vy = mmY(VP.p1) / MM_H * MM_H;
  const vw = (VP.t1 - VP.t0) / fT1 * MM_W, vh = (VP.p1 - VP.p0) / (fP1 - fP0) * MM_H;
  vEl.style.left = Math.max(0, vx) + 'px'; vEl.style.top = Math.max(0, vy) + 'px';
  vEl.style.width = Math.min(MM_W, Math.max(3, vw)) + 'px'; vEl.style.height = Math.min(MM_H, Math.max(3, vh)) + 'px';
}
