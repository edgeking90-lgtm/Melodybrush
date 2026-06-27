/* ════════════════════════════════════════════════════════════
   AUDIO — Sampler
════════════════════════════════════════════════════════════ */
let _audioCtx = null;
function ensureAudio() {
  if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (_audioCtx.state === 'suspended') _audioCtx.resume();
}
const Sampler = (function () {
  const FLAT = ['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B'];
  const raw = {piano: new Map(), violin: new Map()};
  const bufs = {piano: new Map(), violin: new Map()};
  const ftch = {piano: new Set(), violin: new Set()};
  const dcd = {piano: new Set(), violin: new Set()};
  const BASE = 'https://edgeking90-lgtm.github.io/melodysketch';
  const sPath = (ins, m) => `${BASE}/${ins}/${FLAT[m % 12]}${Math.floor(m / 12) - 1}.mp3`;
  const clampM = m => Math.max(21, Math.min(108, Math.round(m)));
  const toMidiEx = cents => 69 + cents / 100;
  const toMidi = cents => clampM(Math.round(69 + cents / 100));
  const PROF = {piano: {vol: 0.24, att: 0.010, rel: 0.080}, violin: {vol: 0.17, att: 0.014, rel: 0.110}};
  let _bus = null;
  function getBus() {
    if (_bus) return _bus;
    const c = _audioCtx.createDynamicsCompressor();
    c.threshold.value = -20; c.knee.value = 8; c.ratio.value = 12; c.attack.value = 0.003; c.release.value = 0.10;
    c.connect(_audioCtx.destination); _bus = c; return _bus;
  }
  async function fetchOne(ins, m) {
    if (raw[ins].has(m) || ftch[ins].has(m)) return;
    ftch[ins].add(m);
    try { const r = await fetch(sPath(ins, m)); if (r.ok) raw[ins].set(m, await r.arrayBuffer()); }
    catch (e) { } finally { ftch[ins].delete(m); }
  }
  function decodeReady(ins) {
    if (!_audioCtx) return;
    raw[ins].forEach((ab, m) => {
      if (bufs[ins].has(m) || dcd[ins].has(m)) return;
      dcd[ins].add(m);
      _audioCtx.decodeAudioData(ab.slice(0), b => { bufs[ins].set(m, b); dcd[ins].delete(m); }, () => dcd[ins].delete(m));
    });
  }
  function nearest(ins, midi) { const b = bufs[ins]; if (!b.size) return null; let best = null, d = Infinity; b.forEach((_, n) => { const dd = Math.abs(n - midi); if (dd < d) { d = dd; best = n; } }); return best; }
  for (let m = 36; m <= 96; m += 3) { fetchOne('piano', m); fetchOne('violin', m); }
  return {
    playGlide(pts, ins, t0) {
      decodeReady(ins);
      const avgMidi = toMidi(pts.reduce((s, p) => s + p.pitch, 0) / pts.length);
      const nm = nearest(ins, avgMidi); if (nm === null) return null;
      const buf = bufs[ins].get(nm); if (!buf) return null;
      const tOff = pts[0].time / 1000, dur = (pts[pts.length - 1].time - pts[0].time) / 1000;
      if (dur < 0.02) return null;
      const src = _audioCtx.createBufferSource();
      src.buffer = buf; src.loop = true;
      src.loopStart = Math.min(buf.duration * 0.35, 0.6);
      src.loopEnd = Math.max(src.loopStart + 0.1, buf.duration * 0.85);
      const step = Math.max(1, Math.floor(pts.length / 200));
      src.playbackRate.setValueAtTime(Math.pow(2, (toMidiEx(pts[0].pitch) - nm) / 12), Math.max(0, t0 + tOff - 0.001));
      for (let i = 0; i < pts.length; i += step)
        src.playbackRate.linearRampToValueAtTime(Math.pow(2, (toMidiEx(pts[i].pitch) - nm) / 12), t0 + pts[i].time / 1000);
      const p = PROF[ins] || PROF.piano, t0n = t0 + tOff;
      const tSus = t0n + Math.max(p.att + 0.005, dur - p.rel), tEnd = t0n + dur + p.rel;
      const g = _audioCtx.createGain(); src.connect(g); g.connect(getBus());
      g.gain.setValueAtTime(0, t0n); g.gain.linearRampToValueAtTime(p.vol, t0n + p.att);
      g.gain.setValueAtTime(p.vol, tSus); g.gain.exponentialRampToValueAtTime(0.0001, tEnd);
      src.start(t0n); src.stop(tEnd + 0.05); return src;
    },
    ready(ins) { return bufs[ins].size > 0; }
  };
})();

let _liveOsc = null, _liveGain = null;
function liveStart(cents) {
  ensureAudio(); liveStop();
  _liveGain = _audioCtx.createGain(); _liveGain.gain.setValueAtTime(0, _audioCtx.currentTime);
  _liveGain.gain.setTargetAtTime(0.14, _audioCtx.currentTime, 0.015);
  _liveOsc = _audioCtx.createOscillator(); _liveOsc.type = 'sine';
  _liveOsc.frequency.value = 440 * Math.pow(2, cents / 1200);
  _liveOsc.connect(_liveGain); _liveGain.connect(_audioCtx.destination); _liveOsc.start();
}
function liveUpdate(cents) { if (!_liveOsc) return; _liveOsc.frequency.setTargetAtTime(440 * Math.pow(2, cents / 1200), _audioCtx.currentTime, 0.012); }
function liveStop() {
  if (!_liveOsc || !_audioCtx) return;
  const o = _liveOsc, g = _liveGain; _liveOsc = null; _liveGain = null;
  const now = _audioCtx.currentTime;
  g.gain.cancelScheduledValues(now); g.gain.setTargetAtTime(0, now, 0.05);
  setTimeout(() => { try { o.stop(); } catch (e) { } }, 220);
}

// Sampler 미로드 시 오실레이터 fallback
function _playOscNote(pts, t0) {
  if (!pts.length) return;
  const tOff = pts[0].time / 1000;
  const dur = (pts[pts.length - 1].time - pts[0].time) / 1000;
  if (dur < 0.02) return;
  const t0n = t0 + tOff;
  const o = _audioCtx.createOscillator();
  const g = _audioCtx.createGain();
  o.type = 'triangle';
  const step = Math.max(1, Math.floor(pts.length / 60));
  o.frequency.setValueAtTime(440 * Math.pow(2, pts[0].pitch / 1200), Math.max(0, t0n - 0.001));
  for (let i = 0; i < pts.length; i += step)
    o.frequency.linearRampToValueAtTime(440 * Math.pow(2, pts[i].pitch / 1200), t0 + pts[i].time / 1000);
  const att = 0.015, rel = 0.08;
  const tSus = t0n + Math.max(att + 0.005, dur - rel), tEnd = t0n + dur + rel;
  g.gain.setValueAtTime(0, t0n); g.gain.linearRampToValueAtTime(0.12, t0n + att);
  g.gain.setValueAtTime(0.12, tSus); g.gain.exponentialRampToValueAtTime(0.0001, tEnd);
  o.connect(g); g.connect(_audioCtx.destination);
  o.start(t0n); o.stop(tEnd + 0.05);
  _activeSrcs.push(o);
}

function playDot(cents) {
  ensureAudio(); const now = _audioCtx.currentTime;
  const o = _audioCtx.createOscillator(), g = _audioCtx.createGain();
  o.type = 'sine'; o.frequency.value = 440 * Math.pow(2, cents / 1200);
  g.gain.setValueAtTime(0.18, now); g.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
  o.connect(g); g.connect(_audioCtx.destination); o.start(now); o.stop(now + 0.45);
}

/* ════════════════════════════════════════════════════════════
   재생
════════════════════════════════════════════════════════════ */
function togglePlay() { _playing ? stopPlay() : startPlay(); }
function startPlay() {
  ensureAudio(); stopPlay();
  if (!_layer.strokes.length && !midiLines.length) { flashHint('재생할 데이터가 없어요'); return; }
  const t0 = _audioCtx.currentTime + 0.08;
  let maxMs = 0;
  for (const s of _layer.strokes) {
    if (!s.pts || s.pts.length < 2) continue;
    maxMs = Math.max(maxMs, s.pts[s.pts.length - 1].time);
    const src = Sampler.playGlide(s.pts, _layer.instrument, t0);
    if (src) _activeSrcs.push(src);
  }
  if (midiLines.length) {
    midiLines.forEach(line => {
      const ins = line.trackIdx === 0 ? 'piano' : 'violin';
      line.fibers.forEach(fiber => {
        if (!fiber.points || !fiber.points.length) return;
        const pts = fiber.points.map(p => ({time: p.t, pitch: p.cents}));
        if (pts.length < 2) pts.push({time: pts[0].time + Math.max(80, fiber.endMs - fiber.startMs), pitch: pts[0].pitch});
        const src = Sampler.playGlide(pts, ins, t0);
        if (src) _activeSrcs.push(src); else _playOscNote(pts, t0);
      });
      maxMs = Math.max(maxMs, line.endMs);
    });
  }
  if (!maxMs) { flashHint('재생할 데이터가 없어요'); return; }
  _playing = true;
  document.getElementById('btn-play').innerHTML = '■<span class="lbl">Stop</span>';
  document.getElementById('pcursor').style.display = 'block';
  const start = performance.now();
  function step(now) {
    if (!_playing) return;
    const el = now - start; _playElapsed = el;
    document.getElementById('pcursor').style.left = tx(el) + 'px';
    render();
    if (el > maxMs + 400) { stopPlay(); return; }
    _playRAF = requestAnimationFrame(step);
  }
  _playRAF = requestAnimationFrame(step);
}
function stopPlay() {
  _activeSrcs.forEach(s => { try { s.stop(0); } catch (e) { } });
  _activeSrcs = []; _playing = false; cancelAnimationFrame(_playRAF); _playElapsed = -9999;
  document.getElementById('pcursor').style.display = 'none';
  document.getElementById('btn-play').innerHTML = '▶<span class="lbl">Play</span>';
  render();
}
