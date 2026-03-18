// ============================================================
//  modal.js — 모달 4종 + JSON 붙여넣기 폴백
//  의존성: config.js, firebase.js, render.js (모두 먼저 로드)
//
//  모달 목록:
//    IRP 납입 입력  → pension-tracker/contributions/irp/{YYYY-MM}
//    ISA 납입 입력  → pension-tracker/contributions/isa/{YYYY-MM}
//    VOO 매도 입력  → pension-tracker/voo/{YYYY}
//    계획 편집      → pension-tracker/plan/{YYYY-MM}
//    JSON 붙여넣기  → 폴백 (Firebase 접근 불가 시)
// ============================================================

const ModalManager = (() => {

  // ── 공통 헬퍼 ─────────────────────────────────────────────
  function _open(id) {
    const el = document.getElementById(id);
    if (el) el.style.display = 'flex';
  }

  function _close(id) {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  }

  function _setError(id, msg) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = msg;
    el.style.display = msg ? 'block' : 'none';
  }

  function _selectedMonth() {
    const el = document.getElementById('input-month');
    return el ? el.value : todayYM();
  }

  // ── IRP 납입 입력 모달 ────────────────────────────────────
  function openIrp() {
    const month = _selectedMonth();
    const existing = AppState.contributions.irp[month] || 0;
    document.getElementById('irp-month').value = month;
    document.getElementById('irp-amount').value = existing || '';
    _setError('irp-error', '');
    _open('modal-irp');
    document.getElementById('irp-amount').focus();
  }

  function closeIrp() { _close('modal-irp'); }

  async function submitIrp() {
    const month  = document.getElementById('irp-month').value.trim();
    const amount = Number(document.getElementById('irp-amount').value);

    if (!month) { _setError('irp-error', '월을 입력해주세요.'); return; }
    if (isNaN(amount) || amount < 0) { _setError('irp-error', '금액을 올바르게 입력해주세요.'); return; }

    const btn = document.getElementById('irp-submit');
    btn.disabled = true;
    _setError('irp-error', '');

    try {
      await FirebaseService.saveContribution('irp', month, amount);
      AppState.contributions.irp[month] = amount;
      Renderer.refreshContribDisplay(month);
      Renderer.renderCharts();
      closeIrp();
    } catch (err) {
      _setError('irp-error', `저장 실패: ${err.message}`);
    } finally {
      btn.disabled = false;
    }
  }

  // ── ISA 납입 입력 모달 ────────────────────────────────────
  function openIsa() {
    const month = _selectedMonth();
    const existing = AppState.contributions.isa[month] || 0;
    document.getElementById('isa-month').value = month;
    document.getElementById('isa-amount').value = existing || '';
    _setError('isa-error', '');
    _open('modal-isa');
    document.getElementById('isa-amount').focus();
  }

  function closeIsa() { _close('modal-isa'); }

  async function submitIsa() {
    const month  = document.getElementById('isa-month').value.trim();
    const amount = Number(document.getElementById('isa-amount').value);

    if (!month) { _setError('isa-error', '월을 입력해주세요.'); return; }
    if (isNaN(amount) || amount < 0) { _setError('isa-error', '금액을 올바르게 입력해주세요.'); return; }

    const btn = document.getElementById('isa-submit');
    btn.disabled = true;
    _setError('isa-error', '');

    try {
      await FirebaseService.saveContribution('isa', month, amount);
      AppState.contributions.isa[month] = amount;
      Renderer.refreshContribDisplay(month);
      Renderer.renderCharts();
      closeIsa();
    } catch (err) {
      _setError('isa-error', `저장 실패: ${err.message}`);
    } finally {
      btn.disabled = false;
    }
  }

  // ── VOO 매도 입력 모달 ────────────────────────────────────
  function openVoo() {
    const year = currentYear();
    const existing = AppState.voo[year] || { sold: 0, gain: 0 };
    document.getElementById('voo-year').value = year;
    document.getElementById('voo-sold').value = existing.sold || '';
    document.getElementById('voo-gain').value = existing.gain || '';
    _setError('voo-error', '');
    _open('modal-voo');
    document.getElementById('voo-sold').focus();
  }

  function closeVoo() { _close('modal-voo'); }

  async function submitVoo() {
    const year = document.getElementById('voo-year').value.trim();
    const sold = Number(document.getElementById('voo-sold').value);
    const gain = Number(document.getElementById('voo-gain').value);

    if (!year || !/^\d{4}$/.test(year)) { _setError('voo-error', '연도를 올바르게 입력해주세요.'); return; }
    if (isNaN(sold) || sold < 0)        { _setError('voo-error', 'VOO 매도금액을 입력해주세요.'); return; }
    if (isNaN(gain) || gain < 0)        { _setError('voo-error', '양도차익을 입력해주세요.'); return; }

    const plan = AppState.activePlan;
    if (gain > plan.voo_annual_limit) {
      const over = gain - plan.voo_annual_limit;
      if (!confirm(
        `⚠️ 양도차익 ${gain.toLocaleString('ko-KR')}원은 연간 한도(${plan.voo_annual_limit.toLocaleString('ko-KR')}원)를 초과합니다.\n` +
        `초과분 ${over.toLocaleString('ko-KR')}원에 대해 22% 과세 대상입니다. 계속 저장하겠습니까?`
      )) return;
    }

    const btn = document.getElementById('voo-submit');
    btn.disabled = true;
    _setError('voo-error', '');

    try {
      await FirebaseService.saveVoo(year, { sold, gain });
      AppState.voo[year] = { sold, gain };
      Renderer.refreshVooDisplay(year);
      Renderer.renderCharts();
      closeVoo();
    } catch (err) {
      _setError('voo-error', `저장 실패: ${err.message}`);
    } finally {
      btn.disabled = false;
    }
  }

  // ── 계획 편집 모달 ────────────────────────────────────────
  function openPlan() {
    const plan = AppState.activePlan;
    const yearKey = todayYM();

    // 주요 계획 필드 채우기
    document.getElementById('plan-pension-monthly').value  = plan.pension_monthly  || '';
    document.getElementById('plan-irp-monthly').value      = plan.irp_monthly      || '';
    document.getElementById('plan-isa-monthly').value      = plan.isa_monthly      || '';
    document.getElementById('plan-pension-annual').value   = plan.pension_annual   || '';
    document.getElementById('plan-irp1-annual').value      = plan.irp1_annual      || '';
    document.getElementById('plan-voo-limit').value        = plan.voo_annual_limit || '';
    document.getElementById('plan-ria-open').value         = plan.ria_open_date    || '';
    document.getElementById('plan-ria-expiry').value       = plan.ria_expiry_date  || '';
    document.getElementById('plan-yearkey').value          = yearKey;
    _setError('plan-error', '');
    _open('modal-plan');
  }

  function closePlan() { _close('modal-plan'); }

  async function submitPlan() {
    const yearKey = document.getElementById('plan-yearkey').value || todayYM();
    const pensionMonthly  = Number(document.getElementById('plan-pension-monthly').value);
    const irpMonthly      = Number(document.getElementById('plan-irp-monthly').value);
    const isaMonthly      = Number(document.getElementById('plan-isa-monthly').value);
    const pensionAnnual   = Number(document.getElementById('plan-pension-annual').value);
    const irp1Annual      = Number(document.getElementById('plan-irp1-annual').value);
    const vooLimit        = Number(document.getElementById('plan-voo-limit').value);
    const riaOpen         = document.getElementById('plan-ria-open').value.trim();
    const riaExpiry       = document.getElementById('plan-ria-expiry').value.trim();

    if (!pensionMonthly || !irpMonthly) {
      _setError('plan-error', '연금저축/IRP 월 납입 계획은 필수입니다.'); return;
    }

    const planData = {
      ...AppState.activePlan,
      pension_monthly:  pensionMonthly,
      irp_monthly:      irpMonthly,
      isa_monthly:      isaMonthly,
      pension_annual:   pensionAnnual  || pensionMonthly * 12,
      irp1_annual:      irp1Annual     || irpMonthly * 12,
      voo_annual_limit: vooLimit       || DEFAULT_PLAN.voo_annual_limit,
      ria_open_date:    riaOpen        || AppState.activePlan.ria_open_date,
      ria_expiry_date:  riaExpiry      || AppState.activePlan.ria_expiry_date,
    };

    const btn = document.getElementById('plan-submit');
    btn.disabled = true;
    _setError('plan-error', '');

    try {
      await FirebaseService.savePlan(yearKey, planData);
      AppState.plan[yearKey]  = planData;
      AppState.activePlan     = planData;
      Renderer.renderCharts();
      closePlan();
    } catch (err) {
      _setError('plan-error', `저장 실패: ${err.message}`);
    } finally {
      btn.disabled = false;
    }
  }

  // ── JSON 붙여넣기 모달 (Firebase 접근 불가 폴백) ──────────
  function openPaste() {
    document.getElementById('paste-area').value = '';
    _setError('paste-error', '');
    _open('modal-paste');
  }

  function closePaste() { _close('modal-paste'); }

  function applyPaste() {
    const raw = document.getElementById('paste-area').value.trim();
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      _setError('paste-error', 'JSON 형식이 올바르지 않습니다.');
      return;
    }
    // asset-dashboard-v3 구조 (state 키-값 직접 붙여넣기) 처리
    Renderer.applyFirebaseData({ state: parsed });
    closePaste();
  }

  return {
    openIrp, closeIrp, submitIrp,
    openIsa, closeIsa, submitIsa,
    openVoo, closeVoo, submitVoo,
    openPlan, closePlan, submitPlan,
    openPaste, closePaste, applyPaste,
  };
})();
