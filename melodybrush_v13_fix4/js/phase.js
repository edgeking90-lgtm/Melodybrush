/* ════════════════════════════════════════════════════════════
   Phase 계산 (실험 구역)
   MIDI → Phase 변환 로직이 여기에 들어갑니다.

   사용 예정 흐름:
     parseMidi(buf)
       ↓
     buildPhases(notes)   ← 이 파일
       ↓
     trackPhases(phases)  ← tracking.js
       ↓
     buildFlowLines(...)  ← flow.js
       ↓
     render()
════════════════════════════════════════════════════════════ */

/**
 * 노트 배열로부터 Phase 목록을 생성합니다.
 * 각 Phase는 하나의 "표현 단위"를 나타냅니다.
 *
 * @param {Array} notes - parseMidi 결과의 note 배열
 * @returns {Array} phases - Phase 객체 배열
 */
function buildPhases(notes) {
  // TODO: Phase 알고리즘 구현
  // 현재는 빈 배열 반환 (기존 파이프라인에 영향 없음)
  return [];
}
