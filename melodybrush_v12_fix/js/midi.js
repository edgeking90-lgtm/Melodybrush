/* ════════════════════════════════════════════════════════════
   MIDI PARSER
════════════════════════════════════════════════════════════ */
function parseMidi(buf) {
  const u8 = new Uint8Array(buf); let pos = 0;
  const r8 = () => u8[pos++];
  const r16 = () => { const v = (u8[pos] << 8) | u8[pos + 1]; pos += 2; return v; };
  const r32 = () => { const v = (u8[pos] << 24) | (u8[pos + 1] << 16) | (u8[pos + 2] << 8) | u8[pos + 3]; pos += 4; return v >>> 0; };
  const rVL = () => { let v = 0, b; do { b = r8(); v = (v << 7) | (b & 0x7f); } while (b & 0x80); return v; };
  if (String.fromCharCode(...u8.slice(0, 4)) !== 'MThd') throw new Error('Not a MIDI file');
  pos += 4; r32();
  const fmt = r16(), nTracks = r16(), tpb = r16();
  const rawTracks = [];
  for (let t = 0; t < nTracks; t++) {
    const hdr = String.fromCharCode(...u8.slice(pos, pos + 4)); pos += 4;
    if (hdr !== 'MTrk') throw new Error('Bad track header');
    const tLen = r32(), end = pos + tLen;
    const evs = []; let tick = 0, status = 0;
    while (pos < end) {
      const dt = rVL(); tick += dt; let b = u8[pos];
      if (b & 0x80) { status = b; pos++; }
      const cmd = status & 0xf0, ch = status & 0x0f;
      if (cmd === 0xff) {
        pos++; const mt = r8(), ml = rVL(), md = u8.slice(pos, pos + ml); pos += ml;
        if (mt === 0x51) evs.push({tick, type: 'tempo', uspb: (md[0] << 16) | (md[1] << 8) | md[2]});
        if (mt === 0x2f) break;
      } else if (cmd === 0xf0 || cmd === 0xf7) { const sl = rVL(); pos += sl; }
      else if (cmd === 0x90 || cmd === 0x80) { const note = r8(), vel = r8(); evs.push({tick, type: (cmd === 0x90 && vel > 0) ? 'on' : 'off', ch, note, vel}); }
      else if (cmd === 0xa0 || cmd === 0xb0 || cmd === 0xe0) { r8(); r8(); }
      else if (cmd === 0xc0 || cmd === 0xd0) { r8(); }
      else pos++;
    }
    pos = end; rawTracks.push(evs);
  }
  let tempos = [{tick: 0, uspb: 500000}];
  rawTracks.flat().filter(e => e.type === 'tempo').sort((a, b) => a.tick - b.tick).forEach(e => tempos.push({tick: e.tick, uspb: e.uspb}));
  function tickToMs(tick) {
    let ms = 0, prev = tempos[0];
    for (let i = 1; i < tempos.length; i++) { const t = tempos[i]; if (t.tick >= tick) break; ms += (t.tick - prev.tick) / tpb * (prev.uspb / 1000); prev = t; }
    return ms + (tick - prev.tick) / tpb * (prev.uspb / 1000);
  }
  detectedBpm = Math.round(60_000_000 / tempos[tempos.length > 1 ? 1 : 0].uspb);
  const result = [];
  rawTracks.forEach((evs, ti) => {
    const byChannel = {};
    evs.forEach(e => { if (e.type !== 'on' && e.type !== 'off') return; if (!byChannel[e.ch]) byChannel[e.ch] = []; byChannel[e.ch].push(e); });
    Object.entries(byChannel).forEach(([ch, cev]) => {
      const open = {}, notes = [];
      cev.forEach(e => {
        if (e.type === 'on') open[e.note] = {tick: e.tick, vel: e.vel};
        else if (open[e.note]) {
          const o = open[e.note], startMs = tickToMs(o.tick), endMs = tickToMs(e.tick);
          if (endMs - startMs > 10) notes.push({midi: e.note, startMs, endMs, durMs: endMs - startMs, velocity: o.vel, trackIdx: ti, ch: +ch});
          delete open[e.note];
        }
      });
      if (notes.length) result.push({trackIdx: ti, ch: +ch, notes: notes.sort((a, b) => a.startMs - b.startMs)});
    });
  });
  result._bpm = detectedBpm; return result;
}

/* ════════════════════════════════════════════════════════════
   AUDIO META
════════════════════════════════════════════════════════════ */
function extractFrameMeta(ab, t0Ms, t1Ms) {
  const sr = ab.sampleRate, ch = ab.getChannelData(0);
  const s0 = Math.max(0, Math.floor(t0Ms / 1000 * sr)), s1 = Math.min(ch.length, Math.ceil(t1Ms / 1000 * sr));
  if (s1 <= s0) return {rms: 0, brightness: 0, pitchHz: 0, confidence: 0};
  const frame = ch.slice(s0, s1), n = frame.length;
  let sum2 = 0; for (let i = 0; i < n; i++) sum2 += frame[i] * frame[i];
  const rms = Math.sqrt(sum2 / n);
  let hi = 0, tot = 0, prev = 0;
  for (let i = 0; i < n; i++) { const s = frame[i], h = s - prev * 0.82; prev = s; hi += h * h; tot += s * s; }
  const brightness = tot > 1e-6 ? Math.sqrt(hi / n) / Math.sqrt(tot / n) : 0;
  let pitchHz = 0, confidence = 0;
  if (rms > 0.008) {
    const minL = Math.floor(sr / 1000), maxL = Math.floor(sr / 70);
    let bL = -1, bC = 0, mean = 0;
    for (let i = 0; i < n; i++) mean += frame[i]; mean /= n;
    for (let lag = minL; lag <= maxL && lag < n; lag++) {
      let c = 0, eA = 0, eB = 0; const lim = Math.min(n - lag, 512);
      for (let i = 0; i < lim; i++) { const a = frame[i] - mean, b = frame[i + lag] - mean; c += a * b; eA += a * a; eB += b * b; }
      const norm = c / Math.sqrt(eA * eB + 1e-9); if (norm > bC) { bC = norm; bL = lag; }
    }
    if (bL > 0 && bC > 0.3) { pitchHz = sr / bL; confidence = bC; }
  }
  return {rms: +rms.toFixed(5), brightness: +Math.min(1, brightness).toFixed(4), pitchHz: +pitchHz.toFixed(2), confidence: +confidence.toFixed(4)};
}

/* ════════════════════════════════════════════════════════════
   CELL DECOMPOSE
════════════════════════════════════════════════════════════ */
function decomposNote(note, cellMs, atkThr, vibCent, decThr, ab) {
  const cells = [], dur = note.durMs, nCell = Math.max(1, Math.ceil(dur / cellMs));
  const vel = note.velocity / 127, useAudio = !!ab;
  const frames = [];
  for (let i = 0; i < nCell; i++) {
    const t0 = note.startMs + i * cellMs, t1 = Math.min(note.startMs + (i + 1) * cellMs, note.endMs);
    if (useAudio) { frames.push(extractFrameMeta(ab, t0, t1)); }
    else {
      const r = i / Math.max(1, nCell - 1), atkF = Math.min(0.15, 2 / nCell), decF = Math.max(0.75, 1 - 3 / nCell);
      let rms;
      if (r < atkF) rms = vel * (r / atkF) * 0.12;
      else if (r > decF) rms = vel * (1 - (r - decF) / (1 - decF)) * 0.10;
      else rms = vel * (0.085 + Math.sin(r * Math.PI) * 0.015);
      frames.push({rms, brightness: 0.7 - r * 0.4 + (i === 0 ? 0.15 : 0), pitchHz: 440 * Math.pow(2, (note.midi - 69) / 12), confidence: (r < 0.05 || r > 0.92) ? 0.45 + vel * 0.3 : 0.7 + vel * 0.25});
    }
  }
  const maxRms = frames.reduce((a, f) => f.rms > a ? f.rms : a, 1e-6);
  const pitchDrifts = frames.map(f => { if (!f.pitchHz || f.confidence < 0.3) return 0; return 69 + 12 * Math.log2(f.pitchHz / 440) - note.midi; });
  const smDrift = pitchDrifts.map((_, i) => { const lo = Math.max(0, i - 1), hi = Math.min(pitchDrifts.length - 1, i + 1); let s = 0, c = 0; for (let j = lo; j <= hi; j++) { s += pitchDrifts[j]; c++; } return s / c; });
  const vibratoDepths = smDrift.map((_, i) => {
    if (i < 2 || i > nCell - 3) return 0;
    const win = smDrift.slice(Math.max(0, i - 3), Math.min(nCell, i + 4));
    const range = win.reduce((a, b) => b > a ? b : a, -Infinity) - win.reduce((a, b) => b < a ? b : a, Infinity);
    let sc = 0; for (let j = 1; j < win.length; j++) if (Math.sign(win[j]) !== Math.sign(win[j - 1])) sc++;
    const vibThresh = Math.max(0.01, (vibCent / 100) * 0.08);
    return range > vibThresh && sc >= 2 ? Math.min(1, range / (vibCent / 100)) : 0;
  });
  for (let i = 0; i < nCell; i++) {
    const f = frames[i], r = i / Math.max(1, nCell - 1);
    const t0 = note.startMs + i * cellMs, t1 = Math.min(note.startMs + (i + 1) * cellMs, note.endMs);
    const energy = +Math.min(1, f.rms / maxRms).toFixed(4);
    const brightness = +Math.min(1, f.brightness).toFixed(4);
    const harmonicRatio = +Math.min(1, f.confidence * (0.6 + energy * 0.4)).toFixed(4);
    const vibratoDepth = +vibratoDepths[i].toFixed(4);
    const pitchDrift = +smDrift[i].toFixed(4);
    const pitchSlope = i > 0 ? +(smDrift[i] - smDrift[i - 1]).toFixed(6) : 0;
    const confidence = +f.confidence.toFixed(4);
    const ePrev = i > 0 ? Math.min(1, frames[i - 1].rms / maxRms) : 0;
    const eNext = i < nCell - 1 ? Math.min(1, frames[i + 1].rms / maxRms) : 0;
    const attackSpeed = +Math.max(0, energy - ePrev).toFixed(4);
    const decaySpeed = +Math.max(0, energy - eNext).toFixed(4);
    let gesture;
    if (i === 0 || attackSpeed > atkThr) gesture = 'ATTACK';
    else if (i === nCell - 1 && nCell > 2) gesture = 'TAIL';
    else if (decaySpeed > decThr && r > 0.5) gesture = 'DECAY';
    else if (vibratoDepth > 0.15) gesture = 'VIBRATO';
    else if (Math.abs(pitchSlope) > 0.08) gesture = 'GLIDE';
    else if (energy < 0.04) gesture = 'NOISE';
    else gesture = 'HOLD';
    cells.push({t0, t1, noteRef: note, gesture, pitch: +(note.midi + pitchDrift).toFixed(4), energy, brightness, harmonicRatio, vibratoDepth, pitchDrift, confidence, attackSpeed, decaySpeed, pitchSlope, cellIndex: i, cellTotal: nCell, fromAudio: useAudio});
  }
  return cells;
}

/* ════════════════════════════════════════════════════════════
   HUMAN FILTER
════════════════════════════════════════════════════════════ */
function runHumanFilter(notes, vibDurMs, glideMinCent, trueThrCent, strength) {
  const result = [];
  for (let i = 1; i < notes.length; i++) {
    const prev = notes[i - 1], cur = notes[i];
    const gap = cur.startMs - prev.endMs, pitchDiff = Math.abs(cur.midi - prev.midi) * 100;
    const overlap = prev.endMs > cur.startMs;
    const prevTail = (prev.cells || []).slice(-3), curHead = (cur.cells || []).slice(0, 3);
    const boundaryVib = [...prevTail, ...curHead].reduce((s, c) => s + c.vibratoDepth, 0) / Math.max(1, prevTail.length + curHead.length);
    const prevEnergy = prevTail.length ? prevTail[prevTail.length - 1].energy : 0;
    const curEnergy = curHead.length ? curHead[0].energy : 0;
    const energyJump = Math.abs(curEnergy - prevEnergy);
    let verdict;
    if (strength < 0.05) { verdict = pitchDiff >= trueThrCent ? 'TRUE_CHANGE' : gap > 400 ? 'PHRASE_BREAK' : 'TRUE_CHANGE'; }
    else {
      const vibScale = 1 + (1 - strength) * 3, glideScale = 1 + (1 - strength) * 2;
      if (boundaryVib > 0.25 * vibScale && pitchDiff < 200) verdict = 'VIBRATO';
      else if (overlap && pitchDiff < glideMinCent / vibScale) verdict = 'VIBRATO';
      else if (gap < vibDurMs && pitchDiff < glideMinCent / vibScale) verdict = 'VIBRATO';
      else if (pitchDiff < trueThrCent / glideScale && gap < 80 && energyJump < 0.3) verdict = 'GLIDE';
      else if (pitchDiff >= trueThrCent) verdict = 'TRUE_CHANGE';
      else if (gap > 400) verdict = 'PHRASE_BREAK';
      else verdict = 'TRUE_CHANGE';
    }
    result.push({fromNote: prev, toNote: cur, pitchDiff, gap, verdict, boundaryVib: +boundaryVib.toFixed(3), energyJump: +energyJump.toFixed(3)});
  }
  return result;
}

/* ════════════════════════════════════════════════════════════
   BUILD LINES / FIBER / CORELINE
════════════════════════════════════════════════════════════ */
function buildLines(tracks) {
  const gapThr = +document.getElementById('gapThr').value;
  const pitchThrS = +document.getElementById('pitchJump').value / 100;
  const minNotes = +document.getElementById('minNotes').value;
  const cellMs = +document.getElementById('cellMs').value;
  const result = []; let lineId = 0;
  tracks.forEach(tr => {
    const notes = tr.notes; if (!notes.length) return;
    let curLine = newLine(lineId++, tr.trackIdx, tr.ch); curLine.notes.push(notes[0]);
    for (let i = 1; i < notes.length; i++) {
      const prev = notes[i - 1], cur = notes[i];
      const gap = cur.startMs - prev.endMs, pitchDiff = Math.abs(cur.midi - prev.midi);
      const overlap = cur.startMs < prev.endMs;
      if ((!overlap && gap > gapThr) || pitchDiff > pitchThrS) {
        if (curLine.notes.length >= minNotes) result.push(finalizeLine(curLine, cellMs));
        curLine = newLine(lineId++, tr.trackIdx, tr.ch);
      }
      curLine.notes.push(cur);
    }
    if (curLine.notes.length >= minNotes) result.push(finalizeLine(curLine, cellMs));
  });
  return result;
}
function newLine(id, trackIdx, ch) { return {id, trackIdx, ch, notes: [], fibers: [], coreline: [], smoothCoreline: [], gestureSummary: {}, pitchRange: [0, 0], startMs: 0, endMs: 0}; }
function makeFiber(note, fiberIdx, lineId, cellMs) {
  const cells = note.cells || [];
  const gs = cells.reduce((a, c) => { a[c.gesture] = (a[c.gesture] || 0) + 1; return a; }, {});
  let wSum = 0, wPitch = 0; cells.forEach(c => { wSum += c.energy; wPitch += c.pitch * c.energy; });
  const avgPitch = wSum > 0 ? wPitch / wSum : note.midi;
  const energy = cells.reduce((s, c) => s + c.energy, 0) / Math.max(1, cells.length);
  const points = cells.map(c => ({t: (c.t0 + c.t1) / 2, pitch: c.pitch, cents: midiToCents(c.pitch), energy: c.energy, gesture: c.gesture, fiberIdx}));
  return {id: fiberIdx, lineId, note, cells, startMs: note.startMs, endMs: note.endMs, avgPitch: +avgPitch.toFixed(3), energy: +energy.toFixed(3), gestureSummary: gs, dominantGesture: Object.entries(gs).sort((a, b) => b[1] - a[1])[0]?.[0] || 'HOLD', points};
}
function finalizeLine(line, cellMs) {
  const notes = line.notes;
  line.startMs = notes[0].startMs; line.endMs = notes[notes.length - 1].endMs;
  let minP = Infinity, maxP = -Infinity;
  notes.forEach(n => { if (n.midi < minP) minP = n.midi; if (n.midi > maxP) maxP = n.midi; });
  line.pitchRange = [minP, maxP];
  line.fibers = notes.map((n, i) => makeFiber(n, i, line.id, cellMs));
  line.coreline = line.fibers.flatMap(f => f.points);
  line.smoothCoreline = buildSmoothCoreline(line);
  line.gestureSummary = line.fibers.reduce((a, f) => { Object.entries(f.gestureSummary).forEach(([g, n]) => { a[g] = (a[g] || 0) + n; }); return a; }, {});
  line.color = TRACK_COLS[line.trackIdx % TRACK_COLS.length];
  line.label = `L${line.id} T${line.trackIdx} ch${line.ch}`;
  return line;
}
function buildSmoothCoreline(line) {
  const pts = [];
  line.fibers.forEach((fiber) => {
    const cents = midiToCents(fiber.note.midi);
    if (fiber.points.length) {
      const startCents = fiber.points[0].cents;
      const endCents = fiber.points[fiber.points.length - 1].cents;
      let wSum = 0, wCents = 0; fiber.points.forEach(p => { wSum += p.energy; wCents += p.cents * p.energy; });
      const midCents = wSum > 0 ? wCents / wSum : startCents;
      const durMs = fiber.endMs - fiber.startMs;
      if (durMs > 100) {
        pts.push({t: fiber.startMs, cents: startCents, energy: fiber.energy});
        pts.push({t: (fiber.startMs + fiber.endMs) / 2, cents: midCents, energy: fiber.energy});
        pts.push({t: fiber.endMs, cents: endCents, energy: fiber.energy});
      } else {
        pts.push({t: fiber.startMs, cents: startCents, energy: fiber.energy});
        pts.push({t: fiber.endMs, cents: endCents, energy: fiber.energy});
      }
    } else {
      // cell 없음 — note의 midi 값으로 직접 점 생성
      const durMs = fiber.endMs - fiber.startMs;
      const energy = fiber.note.velocity / 127;
      if (durMs > 100) {
        pts.push({t: fiber.startMs, cents, energy});
        pts.push({t: (fiber.startMs + fiber.endMs) / 2, cents, energy});
        pts.push({t: fiber.endMs, cents, energy});
      } else {
        pts.push({t: fiber.startMs, cents, energy});
        pts.push({t: fiber.endMs, cents, energy});
      }
    }
  });
  const clean = []; let lastT = -Infinity;
  pts.forEach(p => { if (p.t > lastT + 5) { clean.push(p); lastT = p.t; } });
  return clean;
}

/* ════════════════════════════════════════════════════════════
   EXPRESSION ENGINE
════════════════════════════════════════════════════════════ */
function runExpressionEngine() {
  if (!allCells.length) return [];
  const events = [], vs = +document.getElementById('velScale').value;
  const pbSemi = +document.getElementById('pbRange').value, pbScale = 8191 / pbSemi;
  const vbDepth = +document.getElementById('vibPbDepth').value;
  const glDepth = +document.getElementById('glidePb').value;
  const decCv = +document.getElementById('decCurve').value;
  midiTracks.forEach((tr, trIdx) => {
    const ch = trIdx % 15, safeCh = ch >= 9 ? ch + 1 : ch;
    tr.notes.forEach(n => {
      const vel = Math.round(clamp(n.velocity * vs, 1, 127));
      events.push({tMs: n.startMs, type: 'noteOn', ch: safeCh, val1: n.midi, val2: vel});
      events.push({tMs: n.endMs, type: 'noteOff', ch: safeCh, val1: n.midi, val2: 0});
    });
    events.push({tMs: 0, type: 'pitchBend', ch: safeCh, raw: 0});
    tr.notes.forEach(n => {
      const cells = n.cells || [], nCell = cells.length; if (!nCell) return;
      const decStart = Math.floor(nCell * 0.65); let lastCC11 = -1;
      cells.forEach((c, i) => {
        if (i < decStart) return;
        const r = (i - decStart) / Math.max(1, nCell - 1 - decStart);
        const cc11 = Math.round(clamp(100 * Math.pow(1 - r, 1 + decCv), 5, 100));
        if (Math.abs(cc11 - lastCC11) >= 4) { events.push({tMs: c.t0, type: 'cc', ch: safeCh, val1: 11, val2: cc11}); lastCC11 = cc11; }
      });
      events.push({tMs: n.endMs + 1, type: 'cc', ch: safeCh, val1: 11, val2: 100});
    });
  });
  events.sort((a, b) => { if (a.tMs !== b.tMs) return a.tMs - b.tMs; const o = {pitchBend: 0, cc: 1, noteOn: 2, noteOff: 3}; return (o[a.type] || 0) - (o[b.type] || 0); });
  return events;
}

/* ════════════════════════════════════════════════════════════
   FINAL MIDI BUILDER
════════════════════════════════════════════════════════════ */
function buildFinalMidi(events, bpm) {
  const tpb = 480, uspb = Math.round(60_000_000 / bpm);
  const msToTick = ms => Math.round(ms / 1000 * (bpm / 60) * tpb);
  function varLen(v) { const b = [v & 0x7f]; v >>= 7; while (v > 0) { b.unshift((v & 0x7f) | 0x80); v >>= 7; } return b; }
  const byChannel = {};
  events.forEach(e => { const k = e.ch; if (!byChannel[k]) byChannel[k] = []; byChannel[k].push(e); });
  const trackBytes = Object.values(byChannel).map(evs => {
    const all = [{tMs: 0, _data: [0xff, 0x51, 0x03, (uspb >> 16) & 0xff, (uspb >> 8) & 0xff, uspb & 0xff]}, ...evs];
    all.sort((a, b) => a.tMs - b.tMs);
    const track = []; let lastTick = 0;
    all.forEach(e => {
      const tick = msToTick(e.tMs), dt = Math.max(0, tick - lastTick); lastTick = tick;
      varLen(dt).forEach(b => track.push(b));
      if (e._data) { e._data.forEach(b => track.push(b)); return; }
      switch (e.type) {
        case 'noteOn': track.push(0x90 | e.ch, e.val1, e.val2); break;
        case 'noteOff': track.push(0x80 | e.ch, e.val1, 0); break;
        case 'cc': track.push(0xb0 | e.ch, e.val1, e.val2); break;
        case 'pitchBend': { const pb14 = clamp((e.raw || 0) + 8192, 0, 16383); track.push(0xe0 | e.ch, pb14 & 0x7f, (pb14 >> 7) & 0x7f); } break;
      }
    });
    track.push(0x00, 0xff, 0x2f, 0x00); return track;
  });
  const nTracks = trackBytes.length;
  const header = [0x4d, 0x54, 0x68, 0x64, 0x00, 0x00, 0x00, 0x06, 0x00, 0x01, (nTracks >> 8) & 0xff, nTracks & 0xff, (tpb >> 8) & 0xff, tpb & 0xff];
  const out = [...header];
  trackBytes.forEach(tr => {
    out.push(0x4d, 0x54, 0x72, 0x6b);
    out.push((tr.length >> 24) & 0xff, (tr.length >> 16) & 0xff, (tr.length >> 8) & 0xff, tr.length & 0xff);
    tr.forEach(b => out.push(b));
  });
  return new Uint8Array(out);
}
