// ============================================================
//  firebase.js — Firebase Realtime Database 읽기/쓰기 서비스
//  의존성: config.js (FIREBASE_URL_KEY, FIREBASE_URL_DEFAULT)
//
//  설계 원칙:
//    - MyAssetDashBD의 state/kiwoom 데이터는 읽기 전용 (절대 쓰지 않음)
//    - pension-tracker/** 경로만 PATCH 방식으로 쓰기
//    - 전체 PUT 금지 (기존 데이터 보호)
// ============================================================

const FirebaseService = (() => {

  // ── URL 관리 ──────────────────────────────────────────────
  function getUrl() {
    return localStorage.getItem(FIREBASE_URL_KEY) || FIREBASE_URL_DEFAULT;
  }

  function setUrl(url) {
    localStorage.setItem(FIREBASE_URL_KEY, url.trim());
  }

  function clearUrl() {
    localStorage.removeItem(FIREBASE_URL_KEY);
  }

  function _base() {
    return getUrl().replace(/\/$/, '') + '/asset-data';
  }

  // ── 읽기: 전체 asset-data 스냅샷 ─────────────────────────
  async function fetchAll() {
    const res = await fetch(`${_base()}.json`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data) throw new Error('Firebase에 저장된 데이터가 없습니다');
    return data;
  }

  // ── 쓰기: pension-tracker 하위 경로 PATCH ────────────────
  // subPath: e.g. 'pension-tracker/records/2026-03'
  async function _patch(subPath, payload) {
    const url = `${_base()}/${subPath}.json`;
    const res = await fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`PATCH 실패 (HTTP ${res.status})`);
    return res.json();
  }

  // ── 월별 실적 스냅샷 저장 ────────────────────────────────
  // record: { pension, irp1, irp2, isa, overseas, ria, c_pension, c_irp, c_isa, tax_refund, voo_sold, voo_gain }
  async function saveRecord(month, record) {
    return _patch(`pension-tracker/records/${month}`, {
      ...record,
      savedAt: new Date().toISOString(),
    });
  }

  // ── 납입 이력 저장 ────────────────────────────────────────
  // type: 'irp' | 'isa'
  async function saveContribution(type, month, amount) {
    return _patch(`pension-tracker/contributions/${type}`, {
      [month]: Number(amount),
    });
  }

  // ── VOO 연간 매도/양도차익 저장 ──────────────────────────
  // data: { sold: number, gain: number }
  async function saveVoo(year, data) {
    return _patch('pension-tracker/voo', { [year]: data });
  }

  // ── 계획 데이터 저장 ──────────────────────────────────────
  // yearKey: e.g. '2026-01' / planData: DEFAULT_PLAN 형태
  async function savePlan(yearKey, planData) {
    return _patch('pension-tracker/plan', { [yearKey]: planData });
  }

  return {
    getUrl,
    setUrl,
    clearUrl,
    fetchAll,
    saveRecord,
    saveContribution,
    saveVoo,
    savePlan,
  };
})();
