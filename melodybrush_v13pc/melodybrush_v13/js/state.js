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

/* ════════════════════════════════════════════════════════════
   캔버스 / 래퍼 전역 레퍼런스
   (main.js 맨 위에서 할당)
════════════════════════════════════════════════════════════ */
var cv, ctx, wrap;

/* ════════════════════════════════════════════════════════════
   뷰포트
════════════════════════════════════════════════════════════ */
let VP = {t0: 0, t1: 10000, p0: -1800, p1: 1800};
let DPR = 1, CW = 0, CH = 0;

function tx(t) { return (t - VP.t0) / (VP.t1 - VP.t0) * CW; }
function xt(x) { return VP.t0 + x / CW * (VP.t1 - VP.t0); }
function ly(p) { return CH * (1 - (p - VP.p0) / (VP.p1 - VP.p0)); }
function yl(y) { return VP.p0 + (1 - y / CH) * (VP.p1 - VP.p0); }

function vpPanBy(dxPx, dyPx) {
  const dt = dxPx / CW * (VP.t1 - VP.t0), dp = dyPx / CH * (VP.p1 - VP.p0);
  VP.t0 -= dt; VP.t1 -= dt; VP.p0 += dp; VP.p1 += dp;
}
// factor: uniform zoom. tFactor/pFactor: independent axis zoom
function vpZoomAt(cx, cy, factor, tFactor, pFactor) {
  const tf = tFactor !== undefined ? tFactor : factor;
  const pf = pFactor !== undefined ? pFactor : factor;
  const tC = xt(cx), pC = yl(cy);
  // Horizontal: allow very wide zoom in (down to 200ms) for line detail
  const tSpan = clamp((VP.t1 - VP.t0) * tf, 200, 1200000);
  // Vertical: slightly wider minimum so notes don't crowd
  const pSpan = clamp((VP.p1 - VP.p0) * pf, 100, 7200);
  VP.t0 = tC - cx / CW * tSpan; VP.t1 = VP.t0 + tSpan;
  VP.p0 = pC - (1 - cy / CH) * pSpan; VP.p1 = VP.p0 + pSpan;
}
function autoFitVP(notes, totalMs) {
  if (!notes.length) { VP = {t0: 0, t1: Math.max(totalMs * 1.05, 5000), p0: -1800, p1: 1800}; return; }
  let lo = Infinity, hi = -Infinity;
  notes.forEach(n => { const c = midiToCents(n.midi); if (c < lo) lo = c; if (c > hi) hi = c; });
  const span = hi - lo, pad = Math.max(500, span * 0.55);
  VP.t0 = -totalMs * 0.03; VP.t1 = totalMs * 1.08;
  VP.p0 = lo - pad; VP.p1 = hi + pad;
  if (VP.p1 - VP.p0 < 900) { const m = (VP.p0 + VP.p1) / 2; VP.p0 = m - 450; VP.p1 = m + 450; }
}

/* ════════════════════════════════════════════════════════════
   LOD — 5단계 줌 레벨
   0 Forest  : tSpan > 60s   — 곡 전체 흐름, 굵은 선
   1 Line    : 15s–60s       — 선의 흐름이 보임
   2 Stroke  : 4s–15s        — Stroke 분절 표시
   3 Cell    : 800ms–4s      — Cell 점 + Gesture 색상
   4 Gesture : < 800ms       — 최대 확대, Gesture 상세
════════════════════════════════════════════════════════════ */
function getLOD() {
  const s = VP.t1 - VP.t0;
  if (s > 60000) return 0;   // Forest
  if (s > 15000) return 1;   // Line
  if (s > 4000)  return 2;   // Stroke
  if (s > 800)   return 3;   // Cell
  return 4;                   // Gesture
}
const LOD_NAMES = ['🌲 Forest', '〰 Line', '〜 Stroke', '· Cell', '✦ Gesture'];

/* ════════════════════════════════════════════════════════════
   앱 모드
════════════════════════════════════════════════════════════ */
let appMode = 'view';
let drawTool = 'draw';

/* ════════════════════════════════════════════════════════════
   분석 데이터
════════════════════════════════════════════════════════════ */
let midiTracks = [], allCells = [], hfResult = [], exprEvents = [];
let detectedBpm = 120, audioBuf = null, audioCtx2 = null;
let midiLines = [], selectedLine = null;

/* ════════════════════════════════════════════════════════════
   Draw 레이어
════════════════════════════════════════════════════════════ */
let _layer = {id: 1, color: '#241f18', instrument: 'piano', strokes: []};
let _drawing = null;
let _catchPoint = null, _catchDragging = false;
const PULL_FALLOFF_MS = 420;
let _catchOrigPts = null, _catchOrigCents = 0, _catchTargetCents = 0, _catchCurCents = 0, _catchRAF = null;
let _holdStart = null, _holdAnchor = null, _holdMoved = false, _holdRAF = null;
const HOLD_DELAY = 400, HOLD_MAX_R = 24, HOLD_GROW = 0.014;
let _history = [];

/* ════════════════════════════════════════════════════════════
   전선 (Wire)
════════════════════════════════════════════════════════════ */
let wireLayer = null, wireMerged = false, wireColor = '#f7f4ec';
let wireMode = 'full';
let _wireDrag = null;

/* ════════════════════════════════════════════════════════════
   재생
════════════════════════════════════════════════════════════ */
let _activeSrcs = [], _playing = false, _playRAF = null, _playElapsed = -9999;

/* ════════════════════════════════════════════════════════════
   미니맵
════════════════════════════════════════════════════════════ */
let _mmTotalMs = 0;
const MM_W = 280, MM_H = 140;
