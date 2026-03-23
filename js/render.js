// ============================================================
//  render.js — UI 렌더링, AppState 관리, 차트
//  의존성: config.js, firebase.js (모두 먼저 로드되어야 함)
// ============================================================

// ── 앱 전역 상태 ──────────────────────────────────────────────
// (modal.js에서도 참조하므로 var로 선언해 전역 노출)
var AppState = {
  raw: null,                     // Firebase fetchAll() 원본 응답
  records: {},                   // pension-tracker/records (YYYY-MM → record)
  contributions: { irp: {}, isa: {} }, // pension-tracker/contributions
  voo: {},                       // pension-tracker/voo (YYYY → { sold, gain })
  plan: {},                      // pension-tracker/plan (YYYY-MM → plan obj)
  activePlan: { ...DEFAULT_PLAN }, // 현재 활성 계획 (Firebase 또는 기본값)
  chartTab:   'trend',
  trendAcct:  'all',
  charts:     {},                // Chart.js 인스턴스 맵
};

// ============================================================
//  Renderer — DOM 조작 전담
// ============================================================
const Renderer = (() => {

  // ── 상태 배지 ──────────────────────────────────────────────
  function setSyncStatus(type, text) {
    const el = document.getElementById('sync-status');
    if (!el) return;
    el.className = `status-${type}`;
    el.textContent = text;
  }

  function showDateWarning(msg) {
    const el = document.getElementById('date-warning');
    if (!el) return;
    el.innerHTML = msg;
    el.style.display = 'block';
  }

  function hideDateWarning() {
    const el = document.getElementById('date-warning');
    if (el) el.style.display = 'none';
  }

  // ── Firebase 응답 → AppState 파싱 ─────────────────────────
  function applyFirebaseData(data) {
    AppState.raw = data;

    // pension-tracker 서브트리
    const pt = data['pension-tracker'] || {};
    AppState.records       = pt.records       || {};
    AppState.contributions = {
      irp: (pt.contributions || {}).irp || {},
      isa: (pt.contributions || {}).isa || {},
    };
    AppState.voo  = pt.voo  || {};
    AppState.plan = pt.plan || {};

    // 활성 계획: plan에서 가장 최근 키 사용, 없으면 DEFAULT_PLAN
    const planKeys = Object.keys(AppState.plan).sort();
    AppState.activePlan = planKeys.length
      ? { ...DEFAULT_PLAN, ...AppState.plan[planKeys[planKeys.length - 1]] }
      : { ...DEFAULT_PLAN };

    // 잔액 자동 연동
    _fillBalances(data.state || {}, data.kiwoom || null);

    // 날짜 불일치 경고
    _checkDateMismatch(data.state || {});

    // 하위 섹션 갱신
    const month = document.getElementById('input-month').value || todayYM();
    refreshContribDisplay(month);
    refreshVooDisplay(currentYear());
    renderHistory();
    renderCharts();
  }

  // ── 잔액 자동 채우기 ──────────────────────────────────────
  function _fillBalances(state, kiwoom) {
    const month = document.getElementById('input-month').value || todayYM();
    let filled = 0;
    const dates = [];

    FIELD_MAP.forEach(({ key, fieldId, badgeId, label }) => {
      const entry = _getStateEntry(state, key);
      const input = document.getElementById(fieldId);
      const badge = document.getElementById(badgeId);
      if (!input) return;

      if (entry !== null) {
        input.value = entry.val;
        input.classList.add('auto-filled');
        input.classList.remove('manual-needed');
        if (badge) {
          badge.textContent = entry.date ? `불러옴: ${entry.date}` : '불러옴';
          badge.style.display = 'inline';
        }
        if (entry.date) dates.push(entry.date);
        filled++;
      } else {
        // ISA/RIA 미개설 처리
        input.classList.add('manual-needed');
        input.classList.remove('auto-filled');
        if (badge) badge.style.display = 'none';

        // RIA 미개설 힌트
        if (key === 'ria') _showFieldHint(fieldId, '⏳ 개설 예정 2026-03-30');
        if (key === 'isa') _showFieldHint(fieldId, '⏳ 미시작 (VOO 매도 후 납입 예정)');
      }
    });

    // ISA 잔액: state.isa.val은 투자금(원금) — eval[9](평가금액) 우선 표시
    const isaInput = document.getElementById('f_isa');
    if (isaInput && kiwoom?.combined?.length) {
      const latestEntry = kiwoom.combined[kiwoom.combined.length - 1];
      if ((latestEntry?.eval?.[9] ?? 0) > 0) isaInput.value = latestEntry.eval[9];
    }

    // 연금저축 납입 자동 계산 (kiwoom.combined 델타)
    const cPension = _calcPensionContrib(kiwoom, month);
    const cPensionEl = document.getElementById('disp-c-pension');
    if (cPensionEl) cPensionEl.textContent = fmt(cPension);
    const cPensionHidden = document.getElementById('calc-c-pension');
    if (cPensionHidden) cPensionHidden.value = cPension;

    if (filled > 0) {
      setSyncStatus('success', `✅ ${filled}개 항목 불러옴`);
    } else {
      setSyncStatus('error', '❌ state 데이터 없음');
    }
  }

  function _getStateEntry(state, key) {
    const v = state[key];
    if (v === null || v === undefined) return null;
    if (typeof v === 'object' && 'val' in v) return v;
    if (typeof v === 'number') return { val: v, date: null };
    return null;
  }

  function _showFieldHint(fieldId, text) {
    const hint = document.getElementById(`hint-${fieldId}`);
    if (hint) { hint.textContent = text; hint.style.display = 'block'; }
  }

  // ── 연금저축 납입 자동 계산 (kiwoom.combined invest[3] 델타) ─
  function _calcPensionContrib(kiwoom, month) {
    return _calcInvestDelta(kiwoom, month, 3);
  }

  // ── IRP1 납입 자동 계산 (kiwoom.combined invest[7] 델타) ────
  function _calcIrp1Contrib(kiwoom, month) {
    return _calcInvestDelta(kiwoom, month, 7);
  }

  // ── ISA 납입 자동 계산 ────────────────────────────────────
  // 1순위: invest[9] 델타 (MyAssetDashBD ISA 모달 재적용 후)
  // 2순위: state.isa.val - 이전 records c_isa 합산 (현재 데이터로 바로 계산)
  function _calcIsaContrib(kiwoom, month) {
    const delta = _calcInvestDelta(kiwoom, month, 9);
    if (delta > 0) return delta;
    const isaTotal = AppState.raw?.state?.isa?.val;
    if (!isaTotal || isaTotal <= 0) return 0;
    const prevSum = Object.entries(AppState.records)
      .filter(([m]) => m < month)
      .reduce((s, [, rec]) => s + Number(rec.c_isa || 0), 0);
    return Math.max(0, isaTotal - prevSum);
  }

  function _calcInvestDelta(kiwoom, month, investIdx) {
    if (!kiwoom?.combined?.length) return 0;
    const sorted = [...kiwoom.combined]
      .filter(e => e.month)
      .sort((a, b) => a.month.localeCompare(b.month));
    const idx = sorted.findIndex(e => e.month === month);
    if (idx < 0) return 0;
    const curr = Number(sorted[idx]?.invest?.[investIdx] ?? 0);
    const prev = idx > 0 ? Number(sorted[idx - 1]?.invest?.[investIdx] ?? 0) : 0;
    return Math.max(0, curr - prev);
  }

  // ── 날짜 불일치 경고 ──────────────────────────────────────
  function _checkDateMismatch(state) {
    const month = document.getElementById('input-month').value;
    if (!month) return;
    const dates = FIELD_MAP
      .map(({ key }) => _getStateEntry(state, key)?.date)
      .filter(Boolean);
    const mismatches = dates.filter(d => !d.startsWith(month));
    if (mismatches.length > 0) {
      const uniq = [...new Set(dates)].join(', ');
      showDateWarning(
        `⚠️ Firebase 기준일: ${uniq} — 선택한 월(${month})의 월말 기준이 아닐 수 있습니다. 확인 후 저장하세요.`
      );
    } else {
      hideDateWarning();
    }
  }

  // ── 납입 표시 갱신 (월 변경 시 호출) ─────────────────────
  function refreshContribDisplay(month) {
    // IRP1: invest[7] 델타 자동 계산 우선, 없으면 수동 입력 fallback
    const irpAuto = _calcIrp1Contrib(AppState.raw?.kiwoom, month);
    const irpVal  = irpAuto > 0 ? irpAuto : (AppState.contributions.irp[month] ?? 0);
    const isaAuto = _calcIsaContrib(AppState.raw?.kiwoom, month);
    const isaVal  = isaAuto > 0 ? isaAuto : (AppState.contributions.isa[month] ?? 0);

    const irpEl = document.getElementById('disp-c-irp');
    const isaEl = document.getElementById('disp-c-isa');
    if (irpEl) irpEl.textContent = fmt(irpVal);
    if (isaEl) isaEl.textContent = fmt(isaVal);

    // hidden 필드 (저장 시 사용)
    const irpHid = document.getElementById('calc-c-irp');
    const isaHid = document.getElementById('calc-c-isa');
    if (irpHid) irpHid.value = irpVal;
    if (isaHid) isaHid.value = isaVal;
  }

  // ── VOO 표시 갱신 ─────────────────────────────────────────
  function refreshVooDisplay(year) {
    const voo = AppState.voo[year] || { sold: 0, gain: 0 };
    const soldEl = document.getElementById('disp-voo-sold');
    const gainEl = document.getElementById('disp-voo-gain');
    if (soldEl) soldEl.textContent = fmt(voo.sold);
    if (gainEl) gainEl.textContent = fmt(voo.gain);

    // 잔여 한도 표시
    const plan = AppState.activePlan;
    const remaining = Math.max(0, plan.voo_annual_limit - (voo.gain || 0));
    const remainEl = document.getElementById('disp-voo-remaining');
    if (remainEl) {
      const over = (voo.gain || 0) > plan.voo_annual_limit;
      remainEl.textContent = over
        ? `⚠️ 한도 초과 ${fmt(voo.gain - plan.voo_annual_limit)} 과세 대상`
        : `잔여 매도 가능: ${fmt(remaining)}`;
      remainEl.style.color = over ? 'var(--red)' : 'var(--green)';
    }

    // hidden (저장 시 사용)
    const soldHid = document.getElementById('calc-voo-sold');
    const gainHid = document.getElementById('calc-voo-gain');
    if (soldHid) soldHid.value = voo.sold;
    if (gainHid) gainHid.value = voo.gain;
  }

  // ── 기존 레코드 불러오기 (월 변경 후 불러오기 버튼) ───────
  function fillFormFromRecord(month) {
    const rec = AppState.records[month];
    if (!rec) {
      alert(`${month} 저장된 실적이 없습니다.`);
      return;
    }
    const map = {
      f_pension: rec.pension, f_irp1: rec.irp1, f_irp2: rec.irp2,
      f_isa: rec.isa, f_overseas: rec.overseas, f_ria: rec.ria,
      f_tax: rec.tax_refund,
    };
    Object.entries(map).forEach(([id, val]) => {
      const el = document.getElementById(id);
      if (el && val !== undefined && val !== null) {
        el.value = val;
        el.classList.add('auto-filled');
        el.classList.remove('manual-needed');
      }
    });
    // 납입 hidden 값 갱신
    if (document.getElementById('calc-c-pension'))
      document.getElementById('calc-c-pension').value = rec.c_pension || 0;
    if (document.getElementById('calc-c-irp'))
      document.getElementById('calc-c-irp').value = rec.c_irp || 0;
    if (document.getElementById('calc-c-isa'))
      document.getElementById('calc-c-isa').value = rec.c_isa || 0;

    // 표시 갱신
    if (document.getElementById('disp-c-pension'))
      document.getElementById('disp-c-pension').textContent = fmt(rec.c_pension);
    if (document.getElementById('disp-c-irp'))
      document.getElementById('disp-c-irp').textContent = fmt(rec.c_irp);
    if (document.getElementById('disp-c-isa'))
      document.getElementById('disp-c-isa').textContent = fmt(rec.c_isa);
  }

  // ── 폼 데이터 수집 (저장 시 사용) ─────────────────────────
  function collectFormData(month) {
    const v = id => {
      const el = document.getElementById(id);
      return el ? (Number(el.value) || 0) : 0;
    };
    const year = month.slice(0, 4);
    const voo = AppState.voo[year] || { sold: 0, gain: 0 };

    return {
      pension:    v('f_pension'),
      irp1:       v('f_irp1'),
      irp2:       v('f_irp2'),
      isa:        v('f_isa'),
      overseas:   v('f_overseas'),
      ria:        v('f_ria'),
      c_pension:  v('calc-c-pension'),
      c_irp:      (() => { const a = _calcIrp1Contrib(AppState.raw?.kiwoom, month); return a > 0 ? a : (AppState.contributions.irp[month] || 0); })(),
      c_isa:      (() => { const a = _calcIsaContrib(AppState.raw?.kiwoom, month); return a > 0 ? a : (AppState.contributions.isa[month] || 0); })(),
      tax_refund: v('f_tax'),
      voo_sold:   voo.sold,
      voo_gain:   voo.gain,
    };
  }

  // ── 폼 초기화 ─────────────────────────────────────────────
  function clearForm() {
    AUTO_FIELD_IDS.forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      el.value = '';
      el.classList.remove('auto-filled', 'manual-needed');
    });
    MANUAL_FIELD_IDS.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    FIELD_MAP.forEach(({ badgeId }) => {
      const b = document.getElementById(badgeId);
      if (b) b.style.display = 'none';
    });
    ['calc-c-pension', 'calc-c-irp', 'calc-c-isa'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '0';
    });
    ['disp-c-pension', 'disp-c-irp', 'disp-c-isa'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.textContent = '-';
    });
    hideDateWarning();
  }

  // ── 이력 테이블 렌더링 ─────────────────────────────────────
  function renderHistory() {
    const tbody = document.getElementById('history-body');
    if (!tbody) return;
    const months = Object.keys(AppState.records).sort().reverse();
    if (!months.length) {
      tbody.innerHTML = '<tr><td colspan="13" class="no-data">저장된 실적이 없습니다.</td></tr>';
      return;
    }
    tbody.innerHTML = months.map(m => {
      const d = AppState.records[m];
      return `<tr>
        <td>${m}</td>
        <td>${fmt(d.pension)}</td>
        <td>${fmt(d.irp1)}</td>
        <td>${fmt(d.irp2)}</td>
        <td>${fmt(d.isa)}</td>
        <td>${fmt(d.overseas)}</td>
        <td>${fmt(d.ria)}</td>
        <td>${fmt(d.c_pension)}</td>
        <td>${fmt(d.c_irp)}</td>
        <td>${fmt(d.c_isa)}</td>
        <td>${fmt(d.voo_sold)}</td>
        <td>${fmt(d.voo_gain)}</td>
        <td>${fmt(d.tax_refund)}</td>
      </tr>`;
    }).join('');
  }

  // ── 초기화 (DOMContentLoaded) ─────────────────────────────
  function init() {
    document.getElementById('settings-gas-url').value = FirebaseService.getUrl();
    document.getElementById('header-ts').textContent =
      `오늘: ${new Date().toLocaleDateString('ko-KR')}`;
  }

  // ============================================================
  //  차트 모듈
  // ============================================================

  function _kill(key) {
    if (AppState.charts[key]) {
      AppState.charts[key].destroy();
      AppState.charts[key] = null;
    }
  }

  function _baseChartOpts() {
    return {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: '#e2e8f0', font: { size: 12 }, boxWidth: 16 } },
      },
      scales: {
        x: { ticks: { color: '#7a8499', font: { size: 11 } }, grid: { color: '#2e3247' } },
        y: {
          ticks: { color: '#7a8499', font: { size: 11 }, callback: v => fmtW(v) },
          grid: { color: '#2e3247' },
        },
      },
    };
  }

  function switchChartTab(tab) {
    AppState.chartTab = tab;
    document.querySelectorAll('.chart-tab').forEach(b =>
      b.classList.toggle('active', b.dataset.tab === tab));
    document.querySelectorAll('.chart-pane').forEach(p =>
      p.classList.toggle('active', p.id === 'pane-' + tab));
    renderCharts();
  }

  function selectTrendAcct(btn, acct) {
    AppState.trendAcct = acct;
    btn.closest('.filter-group').querySelectorAll('.filter-btn')
       .forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    renderCharts();
  }

  function renderCharts() {
    const tab = AppState.chartTab;
    if      (tab === 'trend')        _renderTrend();
    else if (tab === 'contribution') _renderContribution();
    else if (tab === 'balance')      _renderBalance();
    else if (tab === 'voo')          _renderVoo();
  }

  // ─── Chart 1: 연금자산 추이 (Line) ─────────────────────────
  function _renderTrend() {
    _kill('trend');
    const recs   = AppState.records;
    const months = Object.keys(recs).sort();
    const canvas = document.getElementById('chart-trend');
    const noEl   = document.getElementById('no-trend');
    if (!canvas) return;

    if (months.length < 2) {
      canvas.style.display = 'none'; noEl.style.display = 'block'; return;
    }
    canvas.style.display = 'block'; noEl.style.display = 'none';

    const g = (m, keys) => keys.reduce((s, k) => s + Number(recs[m][k] || 0), 0);
    const datasets = [];
    const acct = AppState.trendAcct;

    if (acct === 'all') {
      [
        { label: '연금저축', keys: ['pension'],        color: CC.pension },
        { label: 'IRP',     keys: ['irp1', 'irp2'],   color: CC.irp1   },
        { label: 'ISA',     keys: ['isa'],             color: CC.isa    },
        { label: 'RIA',     keys: ['ria'],             color: CC.ria    },
      ].forEach(({ label, keys, color }) => {
        const d = months.map(m => g(m, keys));
        if (d.some(v => v > 0)) {
          datasets.push({
            label, data: d,
            borderColor: color, backgroundColor: color + '18',
            fill: false, tension: 0.35, pointRadius: 3, borderWidth: 1.5,
          });
        }
      });

      // 합계선
      const total = months.map(m => g(m, ['pension', 'irp1', 'irp2', 'isa', 'ria']));
      datasets.unshift({
        label: '연금자산 합계', data: total,
        borderColor: '#ffffff', backgroundColor: 'transparent',
        fill: false, tension: 0.35, pointRadius: 5, pointHoverRadius: 7, borderWidth: 2.5,
      });

      // 누적 계획납입 점선
      const plan = AppState.activePlan;
      const [fy, fm] = months[0].split('-').map(Number);
      const planLine = months.map(m => {
        const [y, mo] = m.split('-').map(Number);
        const n = (y - fy) * 12 + (mo - fm) + 1;
        return n * (plan.pension_monthly + plan.irp_monthly);
      });
      datasets.push({
        label: `누적 계획 납입 (월 ${fmtW(plan.pension_monthly + plan.irp_monthly)}원 기준)`,
        data: planLine,
        borderColor: CC.plan, backgroundColor: 'transparent',
        fill: false, tension: 0, pointRadius: 0, borderWidth: 1.5,
        borderDash: [6, 3],
      });

    } else {
      const map = {
        pension: { keys: ['pension'],       color: CC.pension, label: '연금저축' },
        irp:     { keys: ['irp1', 'irp2'],  color: CC.irp1,   label: 'IRP'     },
        isa:     { keys: ['isa'],           color: CC.isa,    label: 'ISA'     },
        ria:     { keys: ['ria'],           color: CC.ria,    label: 'RIA'     },
      };
      const { keys, color, label } = map[acct] || map.pension;
      datasets.push({
        label, data: months.map(m => g(m, keys)),
        borderColor: color, backgroundColor: color + '25',
        fill: true, tension: 0.35, pointRadius: 4, pointHoverRadius: 6, borderWidth: 2,
      });
    }

    const opts = _baseChartOpts();
    opts.interaction = { mode: 'index', intersect: false };
    opts.plugins.tooltip = {
      callbacks: { label: ctx => ` ${ctx.dataset.label}: ${fmtW(ctx.raw)}원` },
    };
    AppState.charts.trend = new Chart(canvas, {
      type: 'line', data: { labels: months, datasets }, options: opts,
    });
  }

  // ─── Chart 2: 납입 달성률 (Horizontal Bar) ──────────────────
  function _renderContribution() {
    _kill('contribution');
    const recs   = AppState.records;
    const months = Object.keys(recs).sort();
    const canvas = document.getElementById('chart-contribution');
    const noEl   = document.getElementById('no-contribution');
    if (!canvas) return;

    const years = [...new Set(months.map(m => m.slice(0, 4)))].sort().reverse();
    const sel   = document.getElementById('ctrl-year');
    if (!years.length) {
      canvas.style.display = 'none'; noEl.style.display = 'block'; return;
    }
    if (sel && sel.options.length === 0) {
      sel.innerHTML = years.map(y => `<option>${y}</option>`).join('');
    }
    const year = sel ? sel.value || years[0] : years[0];
    canvas.style.display = 'block'; noEl.style.display = 'none';

    const plan = AppState.activePlan;
    let pensionActual = 0, irpActual = 0;
    Object.entries(recs).forEach(([m, d]) => {
      if (m.startsWith(year)) {
        pensionActual += Number(d.c_pension || 0);
        irpActual     += Number(d.c_irp     || 0);
      }
    });

    // contributions 에서도 합산 (record 저장 전 modal 입력분 반영)
    Object.entries(AppState.contributions.irp).forEach(([m, v]) => {
      if (m.startsWith(year) && !recs[m]) irpActual += Number(v || 0);
    });

    const now     = new Date();
    const elapsed = parseInt(year) < now.getFullYear() ? 12
                  : parseInt(year) > now.getFullYear() ? 0
                  : now.getMonth() + 1;
    const pensionPlan = plan.pension_monthly * elapsed;
    const irpPlan     = plan.irp_monthly     * elapsed;
    const annuals     = [plan.pension_annual, plan.irp1_annual];
    const planPro     = [pensionPlan, irpPlan];
    const actuals     = [pensionActual, irpActual];
    const pcts        = actuals.map((a, i) => annuals[i] > 0 ? Math.round(a / annuals[i] * 100) : 0);

    const opts = {
      indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: '#e2e8f0', font: { size: 12 }, boxWidth: 16 } },
        tooltip: {
          callbacks: {
            label: ctx => {
              const v = Number(ctx.raw).toLocaleString('ko-KR');
              if (ctx.datasetIndex === 0) return ` 연간 목표: ${v}원`;
              if (ctx.datasetIndex === 1) return ` 현시점 계획 (${elapsed}개월): ${v}원`;
              return ` 실적: ${v}원  (연간 목표 ${pcts[ctx.dataIndex]}%)`;
            },
          },
        },
      },
      scales: {
        x: { ticks: { color: '#7a8499', font: { size: 11 }, callback: v => fmtW(v) }, grid: { color: '#2e3247' } },
        y: { ticks: { color: '#e2e8f0', font: { size: 13 } }, grid: { color: '#2e3247' } },
      },
    };

    AppState.charts.contribution = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: ['연금저축', 'IRP1'],
        datasets: [
          { label: '연간 목표',   data: annuals, backgroundColor: '#1a2236', borderColor: CC.plan, borderWidth: 1, borderRadius: 4 },
          { label: '현시점 계획', data: planPro, backgroundColor: CC.invest, borderRadius: 4 },
          { label: '실적',        data: actuals, backgroundColor: [CC.pension, CC.irp1], borderRadius: 4 },
        ],
      },
      options: opts,
    });
  }

  // ─── Chart 3: 원금 vs 평가금액 (Grouped Bar) ────────────────
  function _renderBalance() {
    _kill('balance');
    const recs   = AppState.records;
    const months = Object.keys(recs).sort();
    const canvas = document.getElementById('chart-balance');
    const noEl   = document.getElementById('no-balance');
    if (!canvas) return;

    if (!months.length) {
      canvas.style.display = 'none'; noEl.style.display = 'block'; return;
    }
    const sel = document.getElementById('ctrl-month');
    if (sel && sel.options.length === 0) {
      sel.innerHTML = [...months].reverse().map(m => `<option>${m}</option>`).join('');
    }
    const selM = sel ? sel.value || months[months.length - 1] : months[months.length - 1];
    const d    = recs[selM];
    if (!d) { canvas.style.display = 'none'; noEl.style.display = 'block'; return; }
    canvas.style.display = 'block'; noEl.style.display = 'none';

    // 누적 납입원금: kiwoom.combined에서 selM 이하 가장 최근 스냅샷의 invest 값 사용
    // (월별 c_pension 델타 합산은 미저장 달이 누락되어 부정확)
    const _kiInvest = (investIdx) => {
      const kiwoom = AppState.raw?.kiwoom;
      if (!kiwoom?.combined?.length) return 0;
      const entry = [...kiwoom.combined]
        .filter(e => e.month && e.month <= selM)
        .sort((a, b) => b.month.localeCompare(a.month))[0];
      return Number(entry?.invest?.[investIdx] ?? 0);
    };
    const pInvest   = _kiInvest(3);
    const irpInvest = _kiInvest(7);
    const isaInvest = _kiInvest(9);

    const accounts = [
      { label: '연금저축', invest: pInvest,   bal: Number(d.pension  || 0), color: CC.pension },
      { label: 'IRP1',    invest: irpInvest, bal: Number(d.irp1     || 0), color: CC.irp1   },
      { label: 'IRP2',    invest: 0,         bal: Number(d.irp2     || 0), color: CC.irp2   },
      { label: 'ISA',     invest: isaInvest, bal: Number(d.isa      || 0), color: CC.isa    },
      { label: 'RIA',     invest: 0,         bal: Number(d.ria      || 0), color: CC.ria    },
    ].filter(a => a.bal > 0 || a.invest > 0);

    const opts = _baseChartOpts();
    opts.plugins.tooltip = {
      callbacks: {
        label: ctx => {
          const a = accounts[ctx.dataIndex];
          if (ctx.dataset.label === '평가금액' && a.invest > 0) {
            const gain = a.bal - a.invest;
            const pct  = (gain / a.invest * 100).toFixed(1);
            const sign = gain >= 0 ? '+' : '';
            return ` 평가금액: ${fmtW(a.bal)}원  (${sign}${fmtW(gain)}원, ${sign}${pct}%)`;
          }
          const tag = a.invest === 0 && ctx.dataset.label === '누적 납입원금' ? ' (미추적)' : '';
          return ` ${ctx.dataset.label}: ${fmtW(ctx.raw)}원${tag}`;
        },
      },
    };

    AppState.charts.balance = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: accounts.map(a => a.label),
        datasets: [
          { label: '누적 납입원금', data: accounts.map(a => a.invest), backgroundColor: CC.invest, borderRadius: 4 },
          {
            label: '평가금액',
            data: accounts.map(a => a.bal),
            backgroundColor: accounts.map(a =>
              a.invest === 0 ? a.color + 'aa' : (a.bal >= a.invest ? '#34d399' : '#f87171')
            ),
            borderRadius: 4,
          },
        ],
      },
      options: opts,
    });
  }

  // ─── Chart 4: VOO 양도차익 (Doughnut) ──────────────────────
  function _renderVoo() {
    _kill('voo');
    const canvas = document.getElementById('chart-voo');
    const noEl   = document.getElementById('no-voo');
    const stats  = document.getElementById('voo-stats');
    if (!canvas) return;

    const year = currentYear();
    const voo  = AppState.voo[year] || {};
    const gain = voo.gain;

    if (gain === undefined || gain === null) {
      canvas.style.display = 'none'; noEl.style.display = 'block';
      if (stats) stats.innerHTML = '';
      return;
    }
    canvas.style.display = 'block'; noEl.style.display = 'none';

    const plan      = AppState.activePlan;
    const limit     = plan.voo_annual_limit;
    const used      = Math.min(Number(gain), limit);
    const remaining = Math.max(0, limit - Number(gain));
    const over      = Math.max(0, Number(gain) - limit);
    const pct       = Math.min(100, Math.round(Number(gain) / limit * 100));

    if (stats) {
      stats.innerHTML = `
        <div style="display:flex;justify-content:center;gap:20px;flex-wrap:wrap;font-size:13px;margin-top:8px">
          <span>실현 차익: <strong style="color:#4f8ef7">${Number(gain).toLocaleString('ko-KR')}원</strong></span>
          <span>연간 한도: <strong style="color:#7a8499">${limit.toLocaleString('ko-KR')}원</strong></span>
          <span>잔여: <strong style="color:${remaining > 0 ? '#34d399' : '#f87171'}">${remaining.toLocaleString('ko-KR')}원</strong></span>
        </div>
        <div style="font-size:12px;margin-top:6px;color:${over > 0 ? '#f87171' : '#34d399'}">
          ${over > 0
            ? `⚠️ 한도 초과 ${over.toLocaleString('ko-KR')}원 → 22% 과세 대상`
            : `✅ 한도 내 (${pct}% 사용)  |  추가 매도 가능: ${remaining.toLocaleString('ko-KR')}원 이하`}
        </div>`;
    }

    AppState.charts.voo = new Chart(canvas, {
      type: 'doughnut',
      data: {
        labels: over > 0 ? ['기본공제 한도(250만)', '과세 초과분'] : ['실현 양도차익', '잔여 한도'],
        datasets: [{
          data: over > 0 ? [limit, over] : [used, remaining],
          backgroundColor: over > 0 ? ['#f87171', '#450a0a'] : ['#4f8ef7', '#1a2236'],
          borderWidth: 0, hoverOffset: 8,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: '62%',
        plugins: {
          legend: { labels: { color: '#e2e8f0', font: { size: 12 }, boxWidth: 14 } },
          tooltip: {
            callbacks: { label: ctx => ` ${ctx.label}: ${Number(ctx.raw).toLocaleString('ko-KR')}원` },
          },
        },
      },
    });
  }

  return {
    init,
    setSyncStatus,
    showDateWarning,
    hideDateWarning,
    applyFirebaseData,
    fillFormFromRecord,
    refreshContribDisplay,
    refreshVooDisplay,
    collectFormData,
    clearForm,
    renderHistory,
    renderCharts,
    switchChartTab,
    selectTrendAcct,
  };
})();
