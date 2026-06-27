/* ════════════════════════════════════════════════════════════
   전선 (Wire Layer) — 3가지 적용 방식
════════════════════════════════════════════════════════════ */

function setWireMode(m) {
  wireMode = m;
  document.querySelectorAll('.wmbtn').forEach(b => b.classList.toggle('act', b.dataset.wm === m));
  document.getElementById('wire-opt-full').style.display  = m === 'full'  ? '' : 'none';
  document.getElementById('wire-opt-pitch').style.display = m === 'pitch' ? '' : 'none';
  document.getElementById('wire-opt-time').style.display  = m === 'time'  ? '' : 'none';
  if (m === 'time') buildSegSliders();
  render();
}
function buildSegSliders() {
  const n = parseInt(document.getElementById('wireSegCount')?.value ?? 4);
  const container = document.getElementById('wire-seg-sliders'); if (!container) return;
  container.innerHTML = '';
  for (let i = 0; i < n; i++) {
    const val = (0.92 - i * (0.92 / (n - 1 || 1))).toFixed(2);
    const row = document.createElement('div');
    row.innerHTML = `<div class="mp-label" style="font-size:.6rem;">구간 ${i + 1} <span class="vv" id="v_wseg${i}">${val}</span></div>
    <input type="range" class="msl" id="wireSeg${i}" min="0" max="1" step="0.01" value="${val}"
      oninput="document.getElementById('v_wseg${i}').textContent=(+this.value).toFixed(2);render()">`;
    container.appendChild(row);
  }
}
function getWireAlphaForPt(pt, lineId) {
  if (wireMode === 'full') return parseFloat(document.getElementById('wireAlpha')?.value ?? 0.92);
  if (wireMode === 'pitch') {
    const hiA = parseFloat(document.getElementById('wireHiAlpha')?.value ?? 0.30);
    const loA = parseFloat(document.getElementById('wireLoAlpha')?.value ?? 0.95);
    const split = parseInt(document.getElementById('wirePitchSplit')?.value ?? 60);
    const midi = Math.round(69 + pt.cents / 100);
    const span = 12;
    const t = clamp((midi - split + span / 2) / span, 0, 1);
    return loA + (hiA - loA) * t;
  }
  if (wireMode === 'time') {
    const n = parseInt(document.getElementById('wireSegCount')?.value ?? 4);
    const totalMs = _mmTotalMs || 10000;
    const segIdx = clamp(Math.floor(pt.t / totalMs * n), 0, n - 1);
    const el = document.getElementById(`wireSeg${segIdx}`);
    return el ? parseFloat(el.value) : 0.92;
  }
  return 0.92;
}
function getWireAlpha() { return parseFloat(document.getElementById('wireAlpha')?.value ?? 0.92); }
function getWireWidth() { return parseInt(document.getElementById('wireWidth')?.value ?? 0); }
function calcWireWidth(line) {
  const manual = getWireWidth(); if (manual > 0) return manual;
  let minC = Infinity, maxC = -Infinity;
  line.fibers.forEach(f => f.cells.forEach(c => { const cents = midiToCents(c.pitch); if (cents < minC) minC = cents; if (cents > maxC) maxC = cents; }));
  const rangePx = Math.abs(ly(minC) - ly(maxC));
  return Math.max(16, rangePx * 1.2 + 8);
}
function calcWireWidthFromPts(wl) { const line = midiLines.find(l => l.id === wl.lineId); return line ? calcWireWidth(line) : 16; }
function applyWireLayer() {
  if (!midiLines.length) { wireStatus('MIDI 분석 데이터가 없습니다'); return; }
  if (wireMode === 'time') buildSegSliders();
  wireLayer = {mode: wireMode, lines: midiLines.map(l => ({lineId: l.id, pts: l.smoothCoreline.map(p => ({...p})), color: l.color, merged: false}))};
  wireMerged = false;
  document.getElementById('btn-merge-wire').disabled = false;
  document.getElementById('btn-remove-wire').disabled = false;
  wireStatus(`전선 생성 (${wireMode === 'full' ? '전체' : wireMode === 'pitch' ? '피치별' : '타임라인별'}) — 피복 투명도로 내부 확인 가능`);
  setAppMode('wire'); render();
}
function mergeWireLayer() {
  if (!wireLayer) { wireStatus('전선 레이어가 없습니다'); return; }
  wireMerged = true; wireLayer.lines.forEach(wl => { wl.merged = true; });
  wireStatus('병합 완료 — 전선 드래그 시 오디오 실시간 반영'); render();
}
function removeWireLayer() {
  wireLayer = null; wireMerged = false;
  document.getElementById('btn-merge-wire').disabled = true;
  document.getElementById('btn-remove-wire').disabled = true;
  wireStatus(''); setAppMode('view'); render();
}
function wireStatus(msg) { const el = document.getElementById('wire-status'); if (el) el.textContent = msg; }
function wireHitTest(x, y) {
  if (!wireLayer || !wireMerged) return null;
  for (const wl of wireLayer.lines) {
    for (const pt of wl.pts) {
      const px = tx(pt.t), py = ly(pt.cents);
      if (Math.hypot(px - x, py - y) < calcWireWidthFromPts(wl) / 2 + 10) return {wl, pt};
    }
  }
  return null;
}
function applyWireDrag(wl, pt, newCents) {
  const delta = newCents - pt.cents; pt.cents = newCents;
  const line = midiLines.find(l => l.id === wl.lineId); if (!line) return;
  let closest = null, minD = Infinity;
  line.smoothCoreline.forEach(sp => { const d = Math.abs(sp.t - pt.t); if (d < minD) { minD = d; closest = sp; } });
  if (closest) closest.cents += delta;
  line.fibers.forEach(fiber => {
    const dt = Math.abs((fiber.startMs + fiber.endMs) / 2 - pt.t);
    const falloff = Math.max(0, 1 - dt / 2000); if (falloff < 0.01) return;
    fiber.points.forEach(p => { p.cents += delta * falloff; });
    fiber.cells.forEach(c => { c.pitch += delta / 100 * falloff; });
  });
}
function enableWireBtn() { const el = document.getElementById('btn-apply-wire'); if (el) el.disabled = false; }

/* Wire 색상 스와치 */
document.querySelectorAll('.wcs').forEach(el => {
  el.addEventListener('click', () => {
    document.querySelectorAll('.wcs').forEach(e => e.classList.remove('act'));
    el.classList.add('act'); wireColor = el.dataset.col; render();
  });
});

/* Wire 슬라이더 바인딩 */
['wireAlpha', 'wireWidth', 'wireHiAlpha', 'wireLoAlpha'].forEach(id => {
  const el = document.getElementById(id); if (!el) return;
  el.addEventListener('input', () => {
    const vmap = {'wireAlpha': 'v_wire_alpha', 'wireWidth': 'v_wire_w', 'wireHiAlpha': 'v_wire_hi_a', 'wireLoAlpha': 'v_wire_lo_a'};
    const vEl = document.getElementById(vmap[id]);
    if (vEl) vEl.textContent = id === 'wireWidth' ? (el.value === '0' ? '자동' : el.value + 'px') : (+el.value).toFixed(2);
    render();
  });
});
const psEl = document.getElementById('wirePitchSplit');
if (psEl) psEl.addEventListener('input', () => { const vEl = document.getElementById('v_wire_psplit'); if (vEl) vEl.textContent = midiToName(+psEl.value); render(); });
const scEl = document.getElementById('wireSegCount');
if (scEl) scEl.addEventListener('input', () => { const vEl = document.getElementById('v_wire_segs'); if (vEl) vEl.textContent = scEl.value; buildSegSliders(); render(); });
