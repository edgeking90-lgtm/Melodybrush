/* 힌트 */
function flashHint(msg) {
  const h = document.getElementById('hint');
  h.textContent = msg; h.style.opacity = '0.9';
  clearTimeout(flashHint._t);
  flashHint._t = setTimeout(() => { h.style.opacity = '0'; }, 2200);
}

/* 로그 */
function log(msg) {
  const d = document.createElement('div');
  d.textContent = `[${new Date().toLocaleTimeString('ko', {hour12: false})}] ${msg}`;
  const lb = document.getElementById('logBox'); lb.appendChild(d); lb.scrollTop = lb.scrollHeight;
}

/* 상단 상태 텍스트 */
function setStatus(msg) { document.getElementById('topbar-status').textContent = msg; }

/* 앱 모드 */
function setAppMode(m) {
  appMode = m;
  ['view', 'note', 'edit', 'wire'].forEach(k => {
    const el = document.getElementById('mbtab-' + k);
    if (el) el.classList.toggle('act', k === m);
  });
  const fab = document.getElementById('edit-fab');
  if (fab) fab.classList.toggle('show', m === 'edit');
  refreshLegend();
  render();
}
function refreshLegend() {
  const show = appMode === 'note' && getLOD() === 2 && midiLines.length > 0;
  document.getElementById('gest-legend').classList.toggle('show', show);
}
function setTool(t) {
  drawTool = t;
  document.getElementById('fab-draw').classList.toggle('act', t === 'draw');
  document.getElementById('fab-catch').classList.toggle('act', t === 'catch');
}

/* 바텀시트 */
function openSheet(tab) {
  const sheet = document.getElementById('panel-sheet');
  const backdrop = document.getElementById('sheet-backdrop');
  // 탭 전환
  const tabMap = { input: 'stab-input', params: 'stab-params', layers: 'stab-layers', result: 'stab-result' };
  if (tabMap[tab]) {
    document.querySelectorAll('.stab').forEach(t => t.classList.remove('on'));
    document.querySelectorAll('.stab-content').forEach(c => c.classList.remove('on'));
    const targetContent = document.getElementById(tabMap[tab]);
    const targetTab = document.querySelector(`.stab[data-tab="${tabMap[tab]}"]`);
    if (targetContent) targetContent.classList.add('on');
    if (targetTab) targetTab.classList.add('on');
    document.getElementById('sheet-title').textContent =
      tab === 'input' ? '파일 불러오기' :
      tab === 'params' ? '파라미터' :
      tab === 'layers' ? '레이어' : '분석 결과';
  }
  sheet.classList.add('open');
  backdrop.classList.add('show');
}
function closeSheet() {
  document.getElementById('panel-sheet').classList.remove('open');
  document.getElementById('sheet-backdrop').classList.remove('show');
}
function switchSheetTab(btn) {
  document.querySelectorAll('.stab').forEach(t => t.classList.remove('on'));
  document.querySelectorAll('.stab-content').forEach(c => c.classList.remove('on'));
  btn.classList.add('on');
  const target = document.getElementById(btn.dataset.tab);
  if (target) target.classList.add('on');
  document.getElementById('sheet-title').textContent =
    btn.dataset.tab === 'stab-input' ? '파일 불러오기' :
    btn.dataset.tab === 'stab-params' ? '파라미터' :
    btn.dataset.tab === 'stab-layers' ? '레이어' : '분석 결과';
}

/* 진행바 */
const yieldUI = () => new Promise(r => setTimeout(r, 0));
function setProgress(pct, label) {
  document.getElementById('prog-wrap').style.display = 'block';
  document.getElementById('prog-bar').style.width = pct + '%';
  document.getElementById('prog-label').textContent = label;
}
function hideProgress() {
  document.getElementById('prog-wrap').style.display = 'none';
  document.getElementById('prog-bar').style.width = '0%';
}

/* 슬라이더 바인딩 */
[
  ['cellMs', 'v_cell', v => v + 'ms'], ['atkThr', 'v_atk', v => (+v).toFixed(2)],
  ['vibCent', 'v_vib', v => v + 'cent'], ['decThr', 'v_dec', v => (+v).toFixed(2)],
  ['hfStrength', 'v_hfstr', v => (+v).toFixed(1)], ['vibDur', 'v_vdur', v => v + 'ms'],
  ['glideMin', 'v_gmin', v => v + 'cent'], ['trueThr', 'v_tch', v => v + 'cent'],
  ['gapThr', 'v_gap', v => v + 'ms'], ['pitchJump', 'v_pjump', v => v + 'cent'],
  ['minNotes', 'v_minn', v => v],
].forEach(([id, vid, fmt]) => {
  const el = document.getElementById(id); if (!el) return;
  el.addEventListener('input', () => { const v = document.getElementById(vid); if (v) v.textContent = fmt(el.value); });
});

/* MIDI 파일 로드 */
document.getElementById('midiFile').addEventListener('change', async () => {
  const f = document.getElementById('midiFile').files[0]; if (!f) return;
  const status = document.getElementById('midiStatus');
  status.style.color = 'rgba(247,244,236,0.35)';
  status.textContent = '읽는 중…';
  closeSheet();
  try {
    const buf = await f.arrayBuffer();
    const raw = parseMidi(buf);
    const totalNotes = raw.reduce((s, tr) => s + tr.notes.length, 0);
    midiTracks = raw; rawMidiTracks = raw; allCells = []; hfResult = []; exprEvents = [];
    midiLines = buildLines(midiTracks);
    const totalDur = midiTracks.flatMap(tr => tr.notes.map(n => n.endMs)).reduce((a, b) => a > b ? a : b, 0);
    const allNotes = midiTracks.flatMap(tr => tr.notes);
    autoFitVP(allNotes, totalDur);
    _mmTotalMs = totalDur;
    renderLayerPanel();
    document.getElementById('drop-hint').classList.add('hidden');
    document.getElementById('btn-export').disabled = false;
    status.style.color = '#4ade80';
    status.textContent = `✓ ${f.name}`;
    setStatus(`${totalNotes}음 / ${midiLines.length}선 / ${detectedBpm}BPM`);
    log(`MIDI 로드: ${f.name} — ${totalNotes}음, ${midiLines.length}선, ${detectedBpm}BPM`);
    setAppMode('view');
  } catch (err) {
    console.error(err);
    status.style.color = '#f87171';
    status.textContent = '오류: ' + err.message;
    log('오류: ' + err.message);
  }
});

/* 레이어 패널 */
function renderLayerPanel() {
  const panel = document.getElementById('layer-panel');
  const noLayers = document.getElementById('no-layers');
  panel.innerHTML = '';
  if (!rawMidiTracks.length) {
    panel.style.display = 'none';
    if (noLayers) noLayers.style.display = 'block';
    return;
  }
  panel.style.display = 'flex';
  panel.style.flexDirection = 'column';
  panel.style.gap = '4px';
  if (noLayers) noLayers.style.display = 'none';
  rawMidiTracks.forEach((tr) => {
    const key = String(tr.trackIdx);
    const color = TRACK_COLS[tr.trackIdx % TRACK_COLS.length];
    const isHidden = hiddenTracks.has(key);
    const item = document.createElement('div');
    item.className = 'layer-item' + (isHidden ? ' hidden-layer' : '');
    item.innerHTML =
      `<span class="layer-eye">${isHidden ? '🚫' : '👁'}</span>` +
      `<div class="layer-dot" style="background:${color}"></div>` +
      `<span class="layer-name">Track ${tr.trackIdx + 1}</span>` +
      `<span class="layer-meta">${tr.notes.length}음</span>`;
    item.querySelector('.layer-eye').addEventListener('click', e => {
      e.stopPropagation();
      const wasPlaying = _playing;
      if (wasPlaying) stopPlay();
      if (hiddenTracks.has(key)) hiddenTracks.delete(key);
      else hiddenTracks.add(key);
      renderLayerPanel();
      render();
      if (wasPlaying) startPlay();
    });
    panel.appendChild(item);
  });
}

/* Pipeline */
async function runPipeline(rawTracks) {
  const cellMs = +document.getElementById('cellMs').value;
  const atkThr = +document.getElementById('atkThr').value;
  const vibCent = +document.getElementById('vibCent').value;
  const decThr = +document.getElementById('decThr').value;
  const vibDur = +document.getElementById('vibDur').value;
  const glideMin = +document.getElementById('glideMin').value;
  const trueThr = +document.getElementById('trueThr').value;
  const hfStr = +document.getElementById('hfStrength').value;
  midiTracks = rawTracks; allCells = []; hfResult = [];
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
  setProgress(82, 'Expression Engine…'); await yieldUI();
  exprEvents = runExpressionEngine();
  const totalDur = midiTracks.flatMap(tr => tr.notes.map(n => n.endMs)).reduce((a, b) => a > b ? a : b, 0);
  document.getElementById('s_notes').textContent = totalNotes;
  document.getElementById('s_cells').textContent = allCells.length;
  document.getElementById('s_lines').textContent = midiLines.length;
  document.getElementById('s_dur').textContent = (totalDur / 1000).toFixed(1) + 's';
  document.getElementById('s_bpm').textContent = detectedBpm + ' BPM';
  const allNotes = midiTracks.flatMap(tr => tr.notes);
  autoFitVP(allNotes, totalDur);
  _mmTotalMs = totalDur;
  renderLayerPanel();
  document.getElementById('btn-export').disabled = false;
  setStatus(`${totalNotes}음 / ${midiLines.length}선 / ${detectedBpm}BPM`);
  setProgress(100, '완료!'); await yieldUI();
  hideProgress();
  document.getElementById('drop-hint').classList.add('hidden');
  setAppMode('view');
}

async function runAnalysis() {
  closeSheet();
  const f = document.getElementById('midiFile').files[0];
  if (!f) { flashHint('MIDI 파일을 먼저 불러오세요'); return; }
  try { const buf = await f.arrayBuffer(); const raw = parseMidi(buf); await runPipeline(raw); }
  catch (err) { console.error(err); log('오류: ' + err.message); hideProgress(); }
}

async function runDemo() {
  closeSheet();
  const melody = [
    {midi: 64, startMs: 0,    durMs: 800,  velocity: 85, trackIdx: 0, ch: 0},
    {midi: 64, startMs: 820,  durMs: 400,  velocity: 75, trackIdx: 0, ch: 0},
    {midi: 67, startMs: 1240, durMs: 1200, velocity: 90, trackIdx: 0, ch: 0},
    {midi: 65, startMs: 2460, durMs: 600,  velocity: 80, trackIdx: 0, ch: 0},
    {midi: 64, startMs: 3080, durMs: 1400, velocity: 88, trackIdx: 0, ch: 0},
    {midi: 62, startMs: 4500, durMs: 800,  velocity: 72, trackIdx: 0, ch: 0},
    {midi: 60, startMs: 5320, durMs: 1800, velocity: 95, trackIdx: 0, ch: 0},
  ];
  const bass = [
    {midi: 48, startMs: 0,    durMs: 2400, velocity: 70, trackIdx: 1, ch: 1},
    {midi: 43, startMs: 2460, durMs: 2600, velocity: 68, trackIdx: 1, ch: 1},
    {midi: 48, startMs: 5320, durMs: 1800, velocity: 72, trackIdx: 1, ch: 1},
  ];
  melody.forEach(n => { n.endMs = n.startMs + n.durMs; });
  bass.forEach(n => { n.endMs = n.startMs + n.durMs; });
  detectedBpm = 120; log('데모 데이터');
  await runPipeline([{trackIdx: 0, ch: 0, notes: melody}, {trackIdx: 1, ch: 1, notes: bass}]);
}

function doMidiSave() {
  if (!exprEvents.length) { flashHint('먼저 분석을 실행해주세요'); return; }
  const bytes = buildFinalMidi(exprEvents, detectedBpm);
  const blob = new Blob([bytes], {type: 'audio/midi'});
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), {href: url, download: 'melodybrush_expression.mid'});
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  log(`저장: ${bytes.length}bytes`);
}
</script>