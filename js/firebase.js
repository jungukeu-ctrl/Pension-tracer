// ============================================================
//  firebase.js — Firebase Auth (이메일/비밀번호) + Realtime Database
//  의존성: config.js (FIREBASE_API_KEY, FIREBASE_URL_KEY, FIREBASE_URL_DEFAULT)
//
//  설계 원칙:
//    - MyAssetDashBD의 state/kiwoom 데이터는 읽기 전용 (절대 쓰지 않음)
//    - pension-tracker/** 경로만 PATCH 방식으로 쓰기
//    - 전체 PUT 금지 (기존 데이터 보호)
//    - 모든 요청에 ?auth=<idToken> 포함 (Firebase 보안 규칙 적용)
// ============================================================

// ─── Auth 상수 ───────────────────────────────────────────────────────────────
const _AUTH_URL_    = 'https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=' + FIREBASE_API_KEY;
const _REFRESH_URL_ = 'https://securetoken.googleapis.com/v1/token?key=' + FIREBASE_API_KEY;
const _LS_TOKEN_    = 'pt_id_token';
const _LS_REFRESH_  = 'pt_refresh_token';
const _LS_EXPIRY_   = 'pt_token_expiry';

let _onAuthReady_ = null;

// ─── 로그인 오버레이 + 로그아웃 버튼 DOM 주입 ────────────────────────────────
function _injectAuthUI_() {
  const overlay = document.createElement('div');
  overlay.id = 'login-overlay';
  overlay.style.cssText = [
    'display:flex', 'position:fixed', 'inset:0',
    'background:#0a0c14', 'z-index:9999',
    'align-items:center', 'justify-content:center',
  ].join(';');
  overlay.innerHTML = `
    <div style="background:#141827;border:1px solid #1e2740;border-radius:16px;
                padding:36px;width:360px;max-width:92vw;text-align:center">
      <div style="font-size:20px;font-weight:500;color:#e2e8f0;margin-bottom:4px">연금전략 트래커</div>
      <div style="font-size:12px;color:#64748b;margin-bottom:28px">로그인하여 계속하세요</div>
      <div style="margin-bottom:12px;text-align:left">
        <label style="font-size:11px;color:#64748b;display:block;margin-bottom:5px">이메일</label>
        <input type="email" id="login-email" autocomplete="email" placeholder="example@email.com"
          style="width:100%;background:#0f1117;border:1px solid #1e2740;color:#e2e8f0;
                 padding:10px 14px;border-radius:8px;font-size:14px;outline:none;box-sizing:border-box"
          onkeydown="if(event.key==='Enter')document.getElementById('login-pw').focus()">
      </div>
      <div style="margin-bottom:20px;text-align:left">
        <label style="font-size:11px;color:#64748b;display:block;margin-bottom:5px">비밀번호</label>
        <input type="password" id="login-pw" autocomplete="current-password"
          style="width:100%;background:#0f1117;border:1px solid #1e2740;color:#e2e8f0;
                 padding:10px 14px;border-radius:8px;font-size:14px;outline:none;box-sizing:border-box"
          onkeydown="if(event.key==='Enter')doLogin()">
      </div>
      <div id="login-error"
           style="display:none;font-size:12px;color:#f87171;margin-bottom:14px;text-align:left"></div>
      <button onclick="doLogin()" id="login-btn"
        style="width:100%;background:#3b82f6;color:#fff;border:none;padding:12px;
               border-radius:8px;font-size:14px;font-weight:700;cursor:pointer;
               font-family:inherit">
        로그인
      </button>
    </div>`;
  document.body.insertBefore(overlay, document.body.firstChild);

  // 로그아웃 버튼 — btn-sync 옆에 삽입
  const syncBtn = document.getElementById('btn-sync');
  if (syncBtn && syncBtn.parentNode) {
    const logoutBtn = document.createElement('button');
    logoutBtn.title = '로그아웃';
    logoutBtn.textContent = '⎋ 로그아웃';
    logoutBtn.className = 'btn btn-secondary btn-sm';
    logoutBtn.onclick = doLogout;
    syncBtn.parentNode.insertBefore(logoutBtn, syncBtn.nextSibling);
  }
}

// ─── 토큰 저장 ───────────────────────────────────────────────────────────────
function _saveTokens_(idToken, refreshToken, expiresIn) {
  localStorage.setItem(_LS_TOKEN_,   idToken);
  localStorage.setItem(_LS_REFRESH_, refreshToken);
  localStorage.setItem(_LS_EXPIRY_,  String(Date.now() + (Number(expiresIn) - 60) * 1000));
}

// ─── 토큰 갱신 ───────────────────────────────────────────────────────────────
async function _refreshIdToken_() {
  const rt = localStorage.getItem(_LS_REFRESH_);
  if (!rt) throw new Error('no_refresh_token');
  const res = await fetch(_REFRESH_URL_, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ grant_type: 'refresh_token', refresh_token: rt }),
  });
  if (!res.ok) throw new Error('refresh_failed');
  const d = await res.json();
  _saveTokens_(d.id_token, d.refresh_token, d.expires_in);
  return d.id_token;
}

// ─── 유효 토큰 반환 (만료 시 자동 갱신) ─────────────────────────────────────
async function _getValidToken_() {
  const token  = localStorage.getItem(_LS_TOKEN_);
  const expiry = Number(localStorage.getItem(_LS_EXPIRY_) || '0');
  if (token && Date.now() < expiry) return token;
  return _refreshIdToken_();
}

// ─── 로그인 버튼 핸들러 (전역) ────────────────────────────────────────────────
async function doLogin() {
  const email = (document.getElementById('login-email') || {}).value || '';
  const pw    = (document.getElementById('login-pw')    || {}).value || '';
  const btn   = document.getElementById('login-btn');
  const errEl = document.getElementById('login-error');
  if (!email || !pw) { _showLoginError_('이메일과 비밀번호를 입력하세요.'); return; }
  if (btn)   { btn.textContent = '로그인 중...'; btn.disabled = true; }
  if (errEl) errEl.style.display = 'none';
  try {
    const res = await fetch(_AUTH_URL_, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ email, password: pw, returnSecureToken: true }),
    });
    const data = await res.json();
    if (!res.ok) {
      const code = (data.error && data.error.message) || '';
      throw new Error(
        (code === 'INVALID_LOGIN_CREDENTIALS' || code === 'EMAIL_NOT_FOUND' || code === 'INVALID_PASSWORD')
          ? '이메일 또는 비밀번호가 올바르지 않습니다.'
          : '로그인 실패: ' + (code || res.status)
      );
    }
    _saveTokens_(data.idToken, data.refreshToken, data.expiresIn);
    _hideLoginOverlay_();
    if (_onAuthReady_) _onAuthReady_();
  } catch (err) {
    _showLoginError_(err.message);
  } finally {
    if (btn) { btn.textContent = '로그인'; btn.disabled = false; }
  }
}

// ─── 로그아웃 (전역) ─────────────────────────────────────────────────────────
function doLogout() {
  localStorage.removeItem(_LS_TOKEN_);
  localStorage.removeItem(_LS_REFRESH_);
  localStorage.removeItem(_LS_EXPIRY_);
  _showLoginOverlay_();
}

// ─── 오버레이 표시/숨김 ──────────────────────────────────────────────────────
function _showLoginOverlay_() {
  const el = document.getElementById('login-overlay');
  if (el) el.style.display = 'flex';
}
function _hideLoginOverlay_() {
  const el = document.getElementById('login-overlay');
  if (el) el.style.display = 'none';
}
function _showLoginError_(msg) {
  const el = document.getElementById('login-error');
  if (el) { el.textContent = msg; el.style.display = 'block'; }
}

// ─── 앱 초기화 진입점 ────────────────────────────────────────────────────────
async function checkAndInitAuth_(callback) {
  _onAuthReady_ = callback;
  _injectAuthUI_();
  try {
    await _getValidToken_();  // 저장된 토큰이 유효하면 바로 통과
    _hideLoginOverlay_();
    callback();
  } catch {
    _showLoginOverlay_();     // 토큰 없음/만료 → 로그인 화면
  }
}

// ============================================================
//  Firebase Realtime Database 읽기/쓰기 서비스
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
    const token = await _getValidToken_();
    const res = await fetch(`${_base()}.json?auth=${encodeURIComponent(token)}`);
    if (res.status === 401) { doLogout(); throw new Error('인증이 만료되었습니다. 다시 로그인해주세요.'); }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data) throw new Error('Firebase에 저장된 데이터가 없습니다');
    return data;
  }

  // ── 쓰기: pension-tracker 하위 경로 PATCH ────────────────
  // subPath: e.g. 'pension-tracker/records/2026-03'
  async function _patch(subPath, payload) {
    const token = await _getValidToken_();
    const url = `${_base()}/${subPath}.json?auth=${encodeURIComponent(token)}`;
    const res = await fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (res.status === 401) { doLogout(); throw new Error('인증이 만료되었습니다. 다시 로그인해주세요.'); }
    if (!res.ok) throw new Error(`PATCH 실패 (HTTP ${res.status})`);
    return res.json();
  }

  // ── 월별 실적 스냅샷 저장 ────────────────────────────────
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
