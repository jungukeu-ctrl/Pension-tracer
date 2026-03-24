// ============================================================
//  init.js — 앱 초기화 및 이벤트 핸들러
//  의존성: config.js → firebase.js → render.js → modal.js → init.js 순서
// ============================================================

window.addEventListener('DOMContentLoaded', () => {
  // 현재 월 설정
  document.getElementById('input-month').value = todayYM();

  // 렌더러 초기화 (URL 표시 등)
  Renderer.init();

  // Firebase Auth 확인 후 앱 초기화
  checkAndInitAuth_(loadFromFirebase);
});

// ── Firebase 불러오기 ─────────────────────────────────────────────
async function loadFromFirebase() {
  const btn = document.getElementById('btn-sync');
  btn.disabled = true;
  Renderer.setSyncStatus('loading', '⏳ 불러오는 중…');

  try {
    const data = await FirebaseService.fetchAll();
    Renderer.applyFirebaseData(data);
  } catch (err) {
    console.error('[PensionTracer] Firebase 호출 실패:', err);
    let hint = err.message;
    if (err.message.includes('404')) {
      hint = 'HTTP 404 — Firebase 규칙이 비공개이거나 데이터가 없습니다. JSON 붙여넣기를 사용하세요.';
    } else if (/40[13]/.test(err.message)) {
      hint = 'Firebase 보안 규칙이 읽기를 차단합니다. JSON 붙여넣기를 사용하세요.';
    } else if (err.message.includes('Failed to fetch') || err.message.includes('NetworkError')) {
      hint = '네트워크 오류. 인터넷 연결 또는 Firebase URL을 확인하세요.';
    }
    Renderer.setSyncStatus('error', `❌ ${hint}`);
    Renderer.showDateWarning(`⚠️ 자동 불러오기 실패: ${hint}`);
  } finally {
    btn.disabled = false;
  }
}

// ── 기준 월 변경 ──────────────────────────────────────────────
function onMonthChange() {
  const month = document.getElementById('input-month').value;
  Renderer.refreshContribDisplay(month);
  Renderer.refreshVooDisplay(month ? month.slice(0, 4) : currentYear());
}

// ── 기존 레코드 불러오기 ───────────────────────────────────────────
function loadMonthRecord() {
  const month = document.getElementById('input-month').value;
  Renderer.fillFormFromRecord(month);
}

// ── Firebase 저장 ───────────────────────────────────────────────────
async function saveRecord() {
  const month = document.getElementById('input-month').value;
  if (!month) { alert('기준 월을 선택해주세요.'); return; }

  const record = Renderer.collectFormData(month);
  const btn    = document.getElementById('btn-save');
  btn.disabled = true;

  try {
    await FirebaseService.saveRecord(month, record);
    AppState.records[month] = { ...record, savedAt: new Date().toISOString() };
    Renderer.renderHistory();
    Renderer.renderCharts();
    const msg = document.getElementById('save-msg');
    msg.classList.add('show');
    setTimeout(() => msg.classList.remove('show'), 2500);
  } catch (err) {
    alert(`저장 실패: ${err.message}`);
  } finally {
    btn.disabled = false;
  }
}

// ── 폼 초기화 ─────────────────────────────────────────────────────────
function clearForm() {
  Renderer.clearForm();
  Renderer.setSyncStatus('idle', '대기중');
}

// ── 설정: URL 저장 / 기본값 복원 ───────────────────────────────────
function saveBannerUrl() {
  const val = document.getElementById('banner-gas-url').value.trim();
  if (!val) { alert('URL을 입력해주세요.'); return; }
  FirebaseService.setUrl(val);
  document.getElementById('settings-gas-url').value = val;
  Renderer.setSyncStatus('success', '✅ URL 저장됨');
}

function saveSettingsUrl() {
  const val = document.getElementById('settings-gas-url').value.trim();
  if (!val) { alert('URL을 입력해주세요.'); return; }
  FirebaseService.setUrl(val);
  Renderer.setSyncStatus('success', '✅ Firebase URL 저장됨');
}

function clearSettingsUrl() {
  if (!confirm('기본 URL로 되돌리겠습니까?')) return;
  FirebaseService.clearUrl();
  document.getElementById('settings-gas-url').value = FIREBASE_URL_DEFAULT;
  Renderer.setSyncStatus('idle', '대기중');
}
