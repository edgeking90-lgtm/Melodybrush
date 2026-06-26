/* ════════════════════════════════════════════════════════════
   힌트
════════════════════════════════════════════════════════════ */
function flashHint(msg) {
  const h = document.getElementById('hint');
  h.textContent = msg; h.style.opacity = '0.85';
  clearTimeout(flashHint._t);
  flashHint._t = setTimeout(() => { h.style.opacity = '0'; }, 2200);
}

/* ════════════════════════════════════════════════════════════
   로그
════════════════════════════════════════════════════════════ */
function log(msg) {
  const d = document.createElement('div');
  d.textContent = `[${new Date().toLocaleTimeString('ko', {hour12: false})}] ${msg}`;
  const lb = document.getElementById('logBox'); lb.appendChild(d); lb.scrollTop = lb.scrollHeight;
}

/* ════════════════════════════════════════════════════════════
   앱 모드 / 툴
════════════════════════════════════════════════════════════ */
function setAppMode(m) {
  appMode = m;
  ['view', 'note', 'edit', 'wire'].forEach(k => { const el = document.getElementById('mbtn-' + k); if (el) el.classList.toggle('act', k === m); });
  document.getElementById('edit-tools').classList.toggle('show', m === 'edit');
  document.getElementById('paper-wrap').classList.toggle('editing', m === 'edit' || m === 'wire');
  refreshLegend();
  flashHint(m === 'view' ? (midiLines.length ? '드래그로 이동 · 휠로 줌' : '선을 그어보세요') : m === 'note' ? '확대하면 Gesture 세부 정보' : m === 'wire' ? (wireLayer ? '피복 투명도로 내부 확인' : '선 입히기로 전선 생성') : '선을 그어 멜로디 추가');
  render();
}
function refreshLegend() {
  const show = appMode === 'note' && getLOD() === 2 && midiLines.length > 0;
  document.getElementById('gest-legend').classList.toggle('show', show);
}
function setTool(t) {
  drawTool = t;
  document.getElementById('btn-draw').classList.toggle('act', t === 'draw');
  document.getElementById('btn-catch').classList.toggle('act', t === 'catch');
}
function setInstrument(ins) {
  _layer.instrument = ins;
  document.getElementById('ibtn-piano').classList.toggle('act', ins === 'piano');
  document.getElementById('ibtn-violin').classList.toggle('act', ins === 'violin');
}

/* ════════════════════════════════════════════════════════════
   패널 탭
════════════════════════════════════════════════════════════ */
function switchPanelTab(btn) {
  document.querySelectorAll('.ptab').forEach(t => t.classList.remove('on'));
  document.querySelectorAll('.tab-section').forEach(s => s.classList.remove('on'));
  btn.classList.add('on'); document.getElementById(btn.dataset.tab).classList.add('on');
}

/* ════════════════════════════════════════════════════════════
   진행바
════════════════════════════════════════════════════════════ */
const yieldUI = () => new Promise(r => setTimeout(r, 0));
function setProgress(pct, label) { document.getElementById('prog-wrap').style.display = 'block'; document.getElementById('prog-bar').style.width = pct + '%'; document.getElementById('prog-label').textContent = label; }
function hideProgress() { document.getElementById('prog-wrap').style.display = 'none'; document.getElementById('prog-bar').style.width = '0%'; }

/* ════════════════════════════════════════════════════════════
   슬라이더 바인딩
════════════════════════════════════════════════════════════ */
[
  ['cellMs', 'v_cell', v => v + 'ms'], ['atkThr', 'v_atk', v => (+v).toFixed(2)],
  ['vibCent', 'v_vib', v => v + 'cent'], ['decThr', 'v_dec', v => (+v).toFixed(2)],
  ['hfStrength', 'v_hfstr', v => (+v).toFixed(1)], ['vibDur', 'v_vdur', v => v + 'ms'],
  ['glideMin', 'v_gmin', v => v + 'cent'], ['trueThr', 'v_tch', v => v + 'cent'],
  ['gapThr', 'v_gap', v => v + 'ms'], ['pitchJump', 'v_pjump', v => v + 'cent'],
  ['minNotes', 'v_minn', v => v], ['pbRange', 'v_pbr', v => v + ' semi'],
  ['vibPbDepth', 'v_vbpb', v => (+v).toFixed(1)], ['glidePb', 'v_glpb', v => (+v).toFixed(1)],
  ['decCurve', 'v_deccv', v => (+v).toFixed(1)], ['velScale', 'v_vs', v => (+v).toFixed(1)],
].forEach(([id, vid, fmt]) => {
  const el = document.getElementById(id); if (!el) return;
  el.addEventListener('input', () => { const v = document.getElementById(vid); if (v) v.textContent = fmt(el.value); });
});

/* ════════════════════════════════════════════════════════════
   MIDI 파일 즉시 로드
════════════════════════════════════════════════════════════ */
document.getElementById('midiFile').addEventListener('change', async () => {
  const f = document.getElementById('midiFile').files[0]; if (!f) return;
  const status = document.getElementById('midiStatus');
  status.style.color = '#9a9490';
  status.textContent = '읽는 중…';
  try {
    const buf = await f.arrayBuffer();
    const raw = parseMidi(buf);
    rawMidiTracks = raw;
    status.style.color = '#3d8f6a';
    status.textContent = `✓ ${f.name} 분석 중…`;
    log(`MIDI 로드: ${f.name} — BPM ${detectedBpm}`);
    await runPipeline(raw);
  } catch (err) {
    console.error(err);
    status.style.color = '#c0392b';
    status.textContent = '오류: ' + err.message;
    log('오류: ' + err.message);
  }
});

/* ════════════════════════════════════════════════════════════
   분석 / 데모 / 저장 / 렌더
════════════════════════════════════════════════════════════ */
async function runPipeline(rawTracks) {
  const cellMs = +document.getElementById('cellMs').value;
  const atkThr = +document.getElementById('atkThr').value;
  const vibCent = +document.getElementById('vibCent').value;
  const decThr = +document.getElementById('decThr').value;
  const vibDur = +document.getElementById('vibDur').value;
  const glideMin = +document.getElementById('glideMin').value;
  const trueThr = +document.getElementById('trueThr').value;
  const hfStr = +document.getElementById('hfStrength').value;
  midiTracks = rawTracks; rawMidiTracks = rawTracks; allCells = []; hfResult = [];
  const totalNotes = rawTracks.reduce((s, tr) => s + tr.notes.length, 0);
  let done = 0;
  setProgress(0, `Cell 분해… 0/${totalNotes}`); await yieldUI();
  for (const tr of midiTracks) {
    const chunks = [];
    for (let i = 0; i < tr.notes.length; i += 20) chunks.push(tr.notes.slice(i, i + 20));
    for (const chunk of chunks) {
      chunk.forEach(n => { n.cells = decomposNote(n, cellMs, atkThr, vibCent, decThr, audioBuf); allCells.push(...n.cells); done++; });
      setProgress(Math.round(done / totalNotes * 60), `Cell 분해… ${done}/${totalNotes}`); await yieldUI();
    }
    setProgress(65, 'Human Filter…'); await yieldUI();
    tr.hf = runHumanFilter(tr.notes, vibDur, glideMin, trueThr, hfStr);
    hfResult.push(...tr.hf);
  }
  setProgress(72, 'Line / Fiber…'); await yieldUI();
  midiLines = buildLines(midiTracks);
  log(`Lines 생성: ${midiLines.length}개 / smoothCoreline 크기: ${midiLines.map(l => l.smoothCoreline.length).join(', ')}`);
  setProgress(82, 'Expression Engine…'); await yieldUI();
  exprEvents = runExpressionEngine();
  const totalDur = midiTracks.flatMap(tr => tr.notes.map(n => n.endMs)).reduce((a, b) => a > b ? a : b, 0);
  document.getElementById('s_notes').textContent = totalNotes;
  document.getElementById('s_cells').textContent = allCells.length;
  document.getElementById('s_lines').textContent = midiLines.length;
  document.getElementById('s_dur').textContent = (totalDur / 1000).toFixed(1) + 's';
  document.getElementById('s_bpm').textContent = detectedBpm + ' BPM';
  log(`분해: ${totalNotes}개 Note → ${allCells.length}개 Cell`);
  log(`Lines: ${midiLines.length}개`);
  const allNotes = midiTracks.flatMap(tr => tr.notes);
  autoFitVP(allNotes, totalDur);
  _mmTotalMs = totalDur;
  renderLineList();
  ['btnExportMidi', 'btnExportJson', 'btn-export'].forEach(id => { const el = document.getElementById(id); if (el) el.disabled = false; });
  enableWireBtn();
  setProgress(100, '완료!'); await yieldUI();
  hideProgress();
  document.getElementById('drop-hint').classList.add('hidden');
  const _sc = document.getElementById('shortcuts'); if (_sc) _sc.classList.add('show');
  const _til = document.getElementById('tab-input-lines'); if (_til) _til.style.display = 'block';
  const _ms = document.getElementById('midiStatus');
  if (_ms) { _ms.style.color = '#3d8f6a'; _ms.textContent = `✓ ${rawMidiTracks.length}개 트랙 / ${midiLines.length}선 / BPM ${detectedBpm}`; }
  renderLayerPanel();
  console.log('[MB] pipeline 완료 — midiLines:', midiLines.length, '/ CW:', CW, '/ CH:', CH, '/ ctx:', !!ctx);
  setAppMode('view'); // 내부에서 render() 호출됨
}

async function runAnalysis() {
  const f = document.getElementById('midiFile').files[0];
  if (!f) { alert('MIDI 파일을 선택해주세요.'); return; }
  try { log(`MIDI: ${f.name}`); const buf = await f.arrayBuffer(); const raw = parseMidi(buf); log(`파싱: ${raw.length}개 Track/Ch, BPM=${detectedBpm}`); await runPipeline(raw); }
  catch (err) { console.error(err); log('오류: ' + err.message); hideProgress(); }
}

async function runDemo() {
  const melody = [
    {midi: 64, startMs: 0, durMs: 800, velocity: 85, trackIdx: 0, ch: 0}, {midi: 64, startMs: 820, durMs: 400, velocity: 75, trackIdx: 0, ch: 0},
    {midi: 67, startMs: 1240, durMs: 1200, velocity: 90, trackIdx: 0, ch: 0}, {midi: 65, startMs: 2460, durMs: 600, velocity: 80, trackIdx: 0, ch: 0},
    {midi: 64, startMs: 3080, durMs: 1400, velocity: 88, trackIdx: 0, ch: 0}, {midi: 62, startMs: 4500, durMs: 800, velocity: 72, trackIdx: 0, ch: 0},
    {midi: 60, startMs: 5320, durMs: 1800, velocity: 95, trackIdx: 0, ch: 0},
  ];
  const bass = [
    {midi: 48, startMs: 0, durMs: 2400, velocity: 70, trackIdx: 1, ch: 1}, {midi: 43, startMs: 2460, durMs: 2600, velocity: 68, trackIdx: 1, ch: 1},
    {midi: 48, startMs: 5320, durMs: 1800, velocity: 72, trackIdx: 1, ch: 1},
  ];
  melody.forEach(n => { n.endMs = n.startMs + n.durMs; }); bass.forEach(n => { n.endMs = n.startMs + n.durMs; });
  detectedBpm = 120; log('데모 데이터');
  await runPipeline([{trackIdx: 0, ch: 0, notes: melody}, {trackIdx: 1, ch: 1, notes: bass}]);
}

function renderLineList() {
  const list = document.getElementById('lineList'); list.innerHTML = '';
  midiLines.forEach(l => {
    const item = document.createElement('div');
    item.className = 'line-item' + (l === selectedLine ? ' sel' : '');
    item.innerHTML = `<div class="li-dot" style="background:${l.color}"></div><span class="li-name">${l.label}</span><span class="li-meta">${l.notes.length}n · ${((l.endMs - l.startMs) / 1000).toFixed(1)}s</span>`;
    item.addEventListener('click', () => { selectedLine = l === selectedLine ? null : l; renderLineList(); render(); });
    list.appendChild(item);
  });
}

function renderLayerPanel() {
  const panel = document.getElementById('layer-panel');
  const list  = document.getElementById('layer-list');
  const count = document.getElementById('layer-count');
  if (!rawMidiTracks.length) { panel.style.display = 'none'; return; }

  panel.style.display = 'block';
  list.innerHTML = '';
  count.textContent = rawMidiTracks.length + '개';

  rawMidiTracks.forEach((tr) => {
    const key      = String(tr.trackIdx); // trackIdx 단위로 관리
    const color    = TRACK_COLS[tr.trackIdx % TRACK_COLS.length];
    const isHidden = hiddenTracks.has(key);

    const item = document.createElement('div');
    item.className = 'layer-item' + (isHidden ? ' hidden-layer' : '');
    item.innerHTML =
      `<span class="layer-eye" title="표시/숨김">${isHidden ? '🚫' : '👁'}</span>` +
      `<div class="layer-dot" style="background:${color}"></div>` +
      `<span class="layer-name">Track ${tr.trackIdx + 1}</span>` +
      `<span class="layer-meta">${tr.notes.length}음</span>`;

    item.querySelector('.layer-eye').addEventListener('click', e => {
      e.stopPropagation();
      const wasPlaying = _playing; // [FIX] 재생 중 상태 저장
      if (wasPlaying) stopPlay();  // [FIX] 이미 스케줄된 오디오 노드 모두 중단
      if (hiddenTracks.has(key)) hiddenTracks.delete(key);
      else hiddenTracks.add(key);
      renderLayerPanel();
      render();
      if (wasPlaying) startPlay(); // [FIX] 변경된 트랙 구성으로 재시작
    });

    list.appendChild(item);
  });
}

function doMidiSave() {
  if (!exprEvents.length) { alert('먼저 분석을 실행해주세요.'); return; }
  const bytes = buildFinalMidi(exprEvents, detectedBpm);
  const blob = new Blob([bytes], {type: 'audio/midi'});
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), {href: url, download: 'melodybrush_expression.mid'});
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  log(`Final MIDI 저장: ${bytes.length}bytes`);
}

function doJsonSave() {
  const out = {
    version: 'melodybrush-pc', createdAt: new Date().toISOString(), bpm: detectedBpm,
    tracks: midiTracks.map(tr => ({trackIdx: tr.trackIdx, ch: tr.ch, notes: tr.notes.map(n => ({midi: n.midi, startMs: n.startMs, durMs: n.durMs, velocity: n.velocity}))})),
    lines: midiLines.map(l => ({id: l.id, label: l.label, startMs: l.startMs, endMs: l.endMs, notes: l.notes.length})),
    events: exprEvents.map(e => ({tMs: e.tMs, type: e.type, ch: e.ch, val1: e.val1, val2: e.val2}))
  };
  const blob = new Blob([JSON.stringify(out, null, 2)], {type: 'application/json'});
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), {href: url, download: 'melodybrush_pc.json'});
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

