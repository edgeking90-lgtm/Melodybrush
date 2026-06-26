/* ════════════════════════════════════════════════════════════
   상수 / 유틸리티
════════════════════════════════════════════════════════════ */
const TRACK_COLS = ['#5b6ea8','#3d8f6a','#a06b30','#7a4a8a','#3a7a8a','#8a5a3a','#5a7a3a','#8a3a5a'];
const GESTURE_COL = {
  ATTACK: '#facc15', HOLD: '#4ade80', VIBRATO: '#c084fc',
  GLIDE: '#f97316', DECAY: '#60a5fa', TAIL: '#94a3b8', NOISE: '#f87171'
};
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const midiToCents = midi => (midi - 69) * 100;
const NOTE_NAMES_W = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
function midiToName(m) { return NOTE_NAMES_W[m % 12] + (Math.floor(m / 12) - 1); }

/* 캔버스 전역 레퍼런스 (main.js / main.mobile.js 에서 할당) */
var cv, ctx, wrap;

/* 뷰포트 */
let VP = {t0: 0, t1: 10000, p0: -2400, p1: 2400};
let DPR = 1, CW = 0, CH = 0;

function tx(t) { return (t - VP.t0) / (VP.t1 - VP.t0) * CW; }
function xt(x) { return VP.t0 + x / CW * (VP.t1 - VP.t0); }
function ly(p) { return CH * (1 - (p - VP.p0) / (VP.p1 - VP.p0)); }
function yl(y) { return VP.p0 + (1 - y / CH) * (VP.p1 - VP.p0); }

function vpPanBy(dxPx, dyPx) {
  const dt = dxPx / CW * (VP.t1 - VP.t0), dp = dyPx / CH * (VP.p1 - VP.p0);
  VP.t0 -= dt; VP.t1 -= dt; VP.p0 += dp; VP.p1 += dp;
}
function vpZoomAt(cx, cy, factor) {
  const tC = xt(cx), pC = yl(cy);
  const tSpan = clamp((VP.t1 - VP.t0) * factor, 400, 900000);
  const pSpan = clamp((VP.p1 - VP.p0) * factor, 150, 6000);
  VP.t0 = tC - cx / CW * tSpan; VP.t1 = VP.t0 + tSpan;
  VP.p0 = pC - (1 - cy / CH) * pSpan; VP.p1 = VP.p0 + pSpan;
}
function autoFitVP(notes, totalMs) {
  if (!notes.length) { VP = {t0: 0, t1: Math.max(totalMs * 1.05, 5000), p0: -1800, p1: 1800}; return; }
  let lo = Infinity, hi = -Infinity;
  notes.forEach(n => { const c = midiToCents(n.midi); if (c < lo) lo = c; if (c > hi) hi = c; });
  const span = hi - lo, pad = Math.max(350, span * 0.40);
  VP.t0 = -totalMs * 0.03; VP.t1 = totalMs * 1.08;
  VP.p0 = lo - pad; VP.p1 = hi + pad;
  if (VP.p1 - VP.p0 < 700) { const m = (VP.p0 + VP.p1) / 2; VP.p0 = m - 350; VP.p1 = m + 350; }
}
function getLOD() { const s = VP.t1 - VP.t0; return s > 25000 ? 0 : s > 4000 ? 1 : 2; }

/* 앱 상태 */
let appMode = 'view';
let drawTool = 'draw';

/* 분석 데이터 */
let midiTracks = [], allCells = [], hfResult = [], exprEvents = [];
let rawMidiTracks = [];
let detectedBpm = 120, audioBuf = null, audioCtx2 = null;
let midiLines = [], selectedLine = null;

/* Draw 레이어 */
let _layer = {id: 1, color: '#241f18', instrument: 'piano', strokes: []};
let _drawing = null;
let _catchPoint = null, _catchDragging = false;
const PULL_FALLOFF_MS = 420;
let _catchOrigPts = null, _catchOrigCents = 0, _catchTargetCents = 0, _catchCurCents = 0, _catchRAF = null;
let _holdStart = null, _holdAnchor = null, _holdMoved = false, _holdRAF = null;
const HOLD_DELAY = 400, HOLD_MAX_R = 24, HOLD_GROW = 0.014;
let _history = [];

/* 레이어 (트랙 표시/숨김) */
var hiddenTracks = new Set();

/* 전선 */
let wireLayer = null, wireMerged = false, wireColor = '#f7f4ec', wireMode = 'full';
let _wireDrag = null;

/* 재생 */
let _activeSrcs = [], _playing = false, _playRAF = null, _playElapsed = -9999;

/* 미니맵 — PC/모바일 크기가 다르므로 각 main에서 덮어씀 */
let _mmTotalMs = 0;
let MM_W = 280, MM_H = 140;
