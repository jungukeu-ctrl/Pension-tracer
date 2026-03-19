// ============================================================
//  config.js — 상수, 필드 매핑, 기본 계획 데이터
//  의존성: 없음 (가장 먼저 로드)
// ============================================================

// ── Firebase ─────────────────────────────────────────────────
const FIREBASE_URL_KEY     = 'firebase_url';
const FIREBASE_URL_DEFAULT = 'https://my-asset-dashboard-9e6f9-default-rtdb.asia-southeast1.firebasedatabase.app';

// ── MyAssetDashBD state → 폼 필드 매핑 ───────────────────────
// key: Firebase state 키 / fieldId: DOM input id / label: UI 표시명
const FIELD_MAP = [
  { key: 'pension-saving',  fieldId: 'f_pension',  badgeId: 'badge-pension',  label: '연금저축 (삼성증권)' },
  { key: 'pension-irp1',   fieldId: 'f_irp1',     badgeId: 'badge-irp1',     label: 'IRP1 (삼성증권)'   },
  { key: 'pension-irp2',   fieldId: 'f_irp2',     badgeId: 'badge-irp2',     label: 'IRP2 (하나증권)'   },
  { key: 'kiwoom-overseas', fieldId: 'f_overseas', badgeId: 'badge-overseas', label: '해외주식 키움 (일반)' },
  { key: 'isa',             fieldId: 'f_isa',      badgeId: 'badge-isa',      label: 'ISA (삼성증권)'    },
  { key: 'ria',             fieldId: 'f_ria',      badgeId: 'badge-ria',      label: 'RIA (키움)'        },
];

// 자동 연동 필드 ID 목록
const AUTO_FIELD_IDS = FIELD_MAP.map(m => m.fieldId);

// 수동 입력 필드 ID (세액공제 환급만 수동)
const MANUAL_FIELD_IDS = ['f_tax'];

// ── 계획 기본값 (Firebase plan이 없을 때 사용) ────────────────
const DEFAULT_PLAN = {
  pension_annual:        15000000,   // 연금저축 연간 납입 계획 (원)
  irp1_annual:            3000000,   // IRP1 연간 납입 계획 (원)
  combined_annual_limit: 18000000,   // 개인연금저축 + IRP1 합산 한도 (법정)
  pension_limit:          6000000,   // 연금저축 세액공제 한도
  irp_limit:              9000000,   // IRP 합산 세액공제 한도
  isa_annual_limit:      20000000,   // ISA 연간 납입 한도 (일반형)
  pension_monthly:        1250000,   // 연금저축 월 납입 계획
  irp_monthly:             250000,   // IRP1 월 납입 계획
  isa_monthly:             250000,   // ISA 월 납입 계획 (VOO 매도 자금)
  ria_open_date:    '2026-03-30',    // RIA 개설 예정일
  ria_expiry_date:  '2027-03-30',    // RIA 만기 예정일 (1년 의무 유지)
  voo_annual_limit:       2500000,   // VOO 양도소득세 연간 기본공제 한도
  tax_rate:                  0.165,  // 세액공제율 16.5%
};

// ── 차트 색상 ─────────────────────────────────────────────────
const CC = {
  pension: '#4f8ef7',
  irp1:    '#34d399',
  irp2:    '#a78bfa',
  isa:     '#fbbf24',
  ria:     '#fb923c',
  invest:  '#2a4a8a',
  plan:    '#4a5568',
};

// ── 공통 포맷터 ───────────────────────────────────────────────
function fmt(n) {
  if (n === null || n === undefined || n === '' || isNaN(Number(n))) return '-';
  return Number(n).toLocaleString('ko-KR') + '원';
}

function fmtW(v) {
  if (v == null || isNaN(v)) return '0';
  const n = Number(v), abs = Math.abs(n);
  if (abs >= 100000000) return (n / 100000000).toFixed(1) + '억';
  if (abs >= 10000)     return Math.round(n / 10000) + '만';
  return n.toLocaleString('ko-KR');
}

function todayYM() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function currentYear() {
  return String(new Date().getFullYear());
}
