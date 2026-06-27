let _audioCtx = null;
function ensureAudio() {
  if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (_audioCtx.state === 'suspended') _audioCtx.resume();
}
const Sampler = { playGlide() { return null; }, ready() { return false; } };
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
  for (let i = 0; i < pts.length; i += step) {
    const tAbs = t0 + pts[i].time / 1000;
    o.frequency.linearRampToValueAtTime(440 * Math.pow(2, pts[i].pitch / 1200), Math.max(t0n, tAbs));
  }
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
function togglePlay() { _playing ? stopPlay() : startPlay(); }
function startPlay() {
  ensureAudio(); stopPlay();
  if (!_layer.strokes.length && !midiLines.length) { flashHint('재생할 데이터가 없어요'); return; }
  const t0 = _audioCtx.currentTime + 0.08;
  const AUDIO_DELAY_MS = 80;
  let maxMs = 0;
  for (const s of _layer.strokes) {
    if (!s.pts || s.pts.length < 2) continue;
    maxMs = Math.max(maxMs, s.pts[s.pts.length - 1].time);
    _playOscNote(s.pts, t0);
  }
  if (midiLines.length) {
    midiLines.forEach(line => {
      if (hiddenTracks.has(String(line.trackIdx))) return;
      line.fibers.forEach(fiber => {
        const midPts = fiber.points && fiber.points.length
          ? fiber.points.map(p => ({time: p.t, pitch: p.cents}))
          : [{time: (fiber.startMs + fiber.endMs) / 2, pitch: midiToCents(fiber.note.midi)}];
        const pts = [
          {time: fiber.startMs, pitch: midPts[0].pitch},
          ...midPts,
          {time: fiber.endMs, pitch: midPts[midPts.length - 1].pitch}
        ];
        _playOscNote(pts, t0);
      });
      maxMs = Math.max(maxMs, line.endMs);
    });
  }
  if (!maxMs) { flashHint('재생할 데이터가 없어요'); return; }
  _playing = true;
  document.getElementById('play-icon').textContent = '■';
  document.getElementById('play-lbl').textContent = '정지';
  document.getElementById('pcursor').style.display = 'block';
  const start = performance.now() - AUDIO_DELAY_MS;
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
  document.getElementById('play-icon').textContent = '▶';
  document.getElementById('play-lbl').textContent = '재생';
  render();
}
</script>