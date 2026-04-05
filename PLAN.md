# Pension-tracer 재구축 계획

## 1. 현황 파악

### MyAssetDashBD Firebase 구조 (`asset-data.json`)
```
asset-data/
  version: 1
  exportedAt: "ISO timestamp"
  state/
    pension-saving:  { val: number(원), date: "YYYY-MM-DD" }  ← 연금저축 잔액
    pension-irp1:    { val: number(원), date: "YYYY-MM-DD" }  ← IRP1 잔액
    pension-irp2:    { val: number(원), date: "YYYY-MM-DD" }  ← IRP2 잔액
    irp1:            { val: number(만원) }                     ← IRP1 누적투자금
    irp2:            { val: number(만원) }                     ← IRP2 누적투자금
    kiwoom-overseas: { val: number(원), date: "YYYY-MM-DD" }  ← 해외주식 잔액
    kiwoom-obil:     { val: number(원), date: "YYYY-MM-DD" }  ← OBil 잔액 (RIA와 완전 별개 계좌)
    isa:             { val: number(원), date: "YYYY-MM-DD" }  ← ISA(삼성증권) ✅ MyAssetDashBD 구현 완료
    ria:             { val: number(원), date: "YYYY-MM-DD" }  ← RIA(키움) ✅ MyAssetDashBD 구현 완료
    toss-*:          { val, date }
    ...
  kiwoom/
    combined: [
      { month: "YYYY-MM", date: "YYYY-MM-DD", eval: [...], invest: [...] }
      ← eval[]    = 월별 평가금액(잔액) — 인덱스 구조 invest[]와 동일
      ← invest[0] = 해외주식 누적투자금
      ← invest[1] = OBil 누적투자금
      ← invest[2] = 자사주 누적투자금
      ← invest[3] = 개인연금저축 누적투자금  ← 💰 삼성증권종합잔고거래내역 JSON 자동 계산 (applyTransferData, idx=3)
      ← invest[7] = IRP1(유정욱) 누적투자금  ← invest[7] 델타 방식 자동 계산 ✅ (2026-03-19 구현)
      ← invest[8] = IRP2(개인형) 누적투자금  ← invest[8] 델타 방식 자동 계산 ✅ (2026-03-19 구현)
      (출처: MyAssetDashBD/js/export.js AI_NAMES 배열, modal.js applyTransferData)
    ]
  state/
    irp1: { val: number(만원) }  ← IRP1 누적투자금 수동 입력값 (MyAssetDashBD에서 관리)
    irp2: { val: number(만원) }  ← IRP2 누적투자금 수동 입력값
  todos: [...]
  goal: { name, target, finName, finTarget }
```

### 계좌 현황 및 조건 요약

| 계좌 | 상태 | 납입 계획 | 조건 / 비고 |
|------|------|-----------|------------|
| **연금저축** | 운용 중 | 월 125만원 (연 1,500만원) | 세액공제 한도 600만원 |
| **IRP1** | 운용 중 | 월 25만원 (연 300만원) | IRP 합산 세액공제 한도 900만원 |
| **IRP2** | 유지 중 (납입 없음) | 없음 | 퇴직 시 퇴직연금 이체 목적, 현재는 잔액만 트래킹 |
| **ISA** | 미시작 (누적 납입 0원) | 월 25만원 (VOO 매도 자금) | 일반형, 연간 한도 2,000만원, VOO 매도 재원으로 납입 예정 |
| **RIA** | **개설 전** (예정일: 2026-03-30) | - | 1년 의무 유지 → 만기 2027-03-30, 만기 후 ISA 이체. 개설 전까지 잔액 0원 |
| **OBil** | 운용 중 | - | **연금 무관 계좌**, `kiwoom-obil` 키. **Pension-tracer에 절대 포함하지 않음** |
| **VOO** | 운용 중 | - | 연간 양도차익 250만원 한도 내에서만 매도 |

### 용어 정의

| 용어 | 의미 | 비고 |
|------|------|------|
| **잔액 = 평가금액** | 현재 계좌 가치 (원금 + 미실현 수익) | 동일 개념, 혼용 가능 |
| **납입액** | 해당 월에 실제로 납입한 금액 | 원금만, 수익 미포함 |
| **누적투자금** | 지금까지 납입한 원금 합계 | `invest[]` 기준 |
| **OBil** | 키움 OBil 계좌 (`kiwoom-obil`) | **연금 무관, Pension-tracer 완전 제외** |
| **RIA** | RIA 별도 계좌 (`state.ria`) | **현재 개설 전** (예정일 2026-03-30). `kiwoom-obil`과 무관 |
| **ISA 연간 한도** | ISA 연간 납입 한도 2,000만원, 일반형 | RIA 이체 시 잔여 한도 계산 필요 |
| **납입 계획** | 개인연금저축 연 1,500만원 + IRP1 연 300만원 = 연 1,800만원 | 월 기준: 연금저축 125만 + IRP1 25만 |

### RIA → ISA 이체 전략

```
RIA 계좌
  - 개설 후 1년 의무 유지 조건
  - 만기 도래 시 ISA 계좌로 이체 계획

이체 시점 판단 기준:
  이체 가능 금액 = ISA 연간 한도(2,000만원) - 당해 연간 누적 ISA 납입액

연도별 ISA 납입 흐름 (확정):
  2027년 3월 (RIA 만기):
    이체 가능금 = 2,000만원 - 1~3월 ISA 납입(25만×3 = 75만원) = 1,925만원
    → 3월에 RIA에서 ISA로 최대 1,925만원 이체
    → 4월~12월(9개월) VOO 매도 자금 ISA 월납입 25만원 홀딩
```

---

## 2. 목표

> **One Source, Multi Use**
> MyAssetDashBD가 실시간 잔액의 Master DB
> Pension-tracer가 연금 전략 계획/실적 분석 전문 앱

- Firebase를 단일 데이터 소스로 읽기+쓰기
- ISA/RIA 잔액을 MyAssetDashBD에서 관리
- 납입 이력, 계획 데이터, VOO 매도 이력을 Firebase에 영구 저장
- 계획 대비 실적 분석, 세액공제 최적화 시각화

---

## 3. Firebase 데이터 구조

### Pension-tracer 전용 경로
```
asset-data/
  pension-tracker/
    plan/
      "2026-01": {
        pension_annual:  15000000,  ← 연금저축 연간 납입 계획(원)
        irp1_annual:     3000000,   ← IRP1 연간 납입 계획(원)
        combined_annual_limit: 18000000,
        pension_limit:  6000000,
        irp_limit:      9000000,
        isa_annual_limit: 20000000,
        pension_monthly: 1250000,
        irp_monthly:    250000,
        isa_monthly:    250000,
        ria_open_date:  "2026-03-30",
        ria_expiry_date: "2027-03-30",
        voo_annual_limit: 2500000,
        tax_rate:       0.165,
      }
    contributions/
      irp/  { "2026-03": 100000, "2026-02": 100000, ... }
      isa/  { "2026-03": 0, ... }
    voo/
      "2026": { sold: 0, gain: 0 }
    records/
      "2026-03": {
        pension: 32396693,
        irp1: ..., irp2: ...,
        isa: ..., overseas: ..., ria: ...,
        c_pension: 500000,   ← 연금저축 납입액 (kiwoom delta 자동)
        c_irp: 100000,
        c_isa: 0,
        tax_refund: 0,
        savedAt: "ISO timestamp"
      }
```

---

## 4. 작업 목록

### Phase 1: MyAssetDashBD — ISA / RIA 모달 추가 ✅ 완료

| # | 작업 | 파일 | 상태 |
|---|------|------|------|
| 1-1 | ISA 스냅샷 카드 (pension-snap + kiwoom-snap 섹션) | `render.js` | ✅ 완료 |
| 1-2 | ISA 잔액 입력 모달 (거래내역 JSON 파싱) | `index.html`, `modal.js` | ✅ 완료 |
| 1-3 | RIA 잔액 입력 모달 (수동 잔액 입력) | `index.html`, `modal.js` | ✅ 완료 |
| 1-4 | `config.js`에 ISA/RIA 키 등록 | `config.js` | ✅ 완료 |
| 1-5 | Firebase PUT 페이로드 자동 포함 | `firebase.js` | ✅ 별도 작업 불필요 |
| A | kiwoom-snap-grid에 RIA 항상 표시 | `render.js` | ✅ 완료 |
| B/C | kiwoom-cards에 ISA·RIA 항상 표시 | `render.js` | ✅ 완료 |
| D/E | pension-snap-grid에 ISA·RIA 항상 표시 | `render.js` | ✅ 완료 |
| F/G | 연금 수동 카드 그리드에 ISA·RIA 추가 | `index.html` | ✅ 완료 |
| IRP | IRP1/IRP2 납입 invest[7]/[8] 델타 자동 계산 | `modal.js` | ✅ 완료 |

---

### Phase 2: Pension-tracer — 완전 재구축 ✅ 완료

#### 파일 구조 (구현 완료)
```
Pension-tracer/
  index.html          ← 메인 앱 (완전 재구축)
  js/
    config.js         ← 상수, Firebase URL
    firebase.js       ← Firebase 읽기(GET)/쓰기(PATCH)
    render.js         ← UI 렌더링 (차트 4종 포함)
    modal.js          ← 모달 4종 로직
  css/
    style.css         ← 다크 테마 스타일
```

#### 구현된 기능

| 기능 | 상태 |
|------|------|
| Firebase 불러오기 (asset-data 전체 GET) | ✅ |
| 연금 계좌 잔액 자동 연동 (연금저축, IRP1/2, ISA, RIA, 해외주식) | ✅ |
| 연금저축 납입 자동 계산 (kiwoom invest[3] 월간 델타) | ✅ |
| IRP1 납입 자동 계산 (invest[7] 델타, 수동 입력 fallback) | ✅ |
| IRP 납입 입력 모달 (pension-tracker/contributions/irp PATCH) | ✅ |
| ISA 납입 입력 모달 (pension-tracker/contributions/isa PATCH) | ✅ |
| ISA 납입 자동 계산 (kiwoom invest[9] 델타, 수동 입력 fallback) | ✅ |
| ISA 잔액 자동 연동 (kiwoom eval[9] 우선 표시) | ✅ |
| RIA 잔액 자동 연동 (kiwoom eval[10] 우선 표시) | ✅ |
| VOO 매도 입력 모달 (pension-tracker/voo PATCH) | ✅ |
| 월 저장 버튼 (pension-tracker/records/{YYYY-MM} PATCH) | ✅ |
| 분석 차트 4종 (Chart.js): 연금자산 추이 / 납입 달성률 / 원금 vs 평가 / VOO 현황 | ✅ |
| 납입 달성률 차트 ISA 막대 표시 버그 수정 (2026-04-05) | ✅ |
| ISA 납입 달성률 state.isa.val fallback 추가 (invest[9] 미저장 시) (2026-04-05) | ✅ |
| OBil과 RIA 완전 분리 (RIA 개설 전 빈값 표시) | ✅ |
| PLAN.md 미결 사항 전체 확정 (ISA 계좌명, Firebase Rules) | ✅ |

---

## 5. 브랜치 / 머지 현황

### Pension-tracer

| 브랜치 | 상태 | 비고 |
|--------|------|------|
| `claude/auto-sync-pension-data-iqIFx` | ✅ 머지 완료 | PR #5 (2026-03-19) |
| `claude/fix-transaction-sync-m8PrB` | ✅ 머지 완료 | IRP1/ISA 동기화 버그픽스 |
| `claude/fix-firebase-data-reset-0VePA` | ✅ 머지 완료 | Firebase PUT→PATCH 버그픽스 |
| `claude/add-kiwoom-ria-support-Rhc1C` | ✅ 머지 완료 (PR #11, 2026-03-24) | RIA eval[10] 잔액 자동 연동 |

### MyAssetDashBD

| 브랜치 | 상태 | 비고 |
|--------|------|------|
| `claude/auto-sync-pension-data-iqIFx` | ✅ 머지 완료 (2026-03-19) | PR #12 |
| `claude/fix-transaction-sync-m8PrB` | ✅ 머지 완료 | IRP1 인식 + ISA 동기화 버그픽스 + 차트 추가 |
| `claude/fix-firebase-data-reset-0VePA` | ✅ 머지 완료 | Firebase PUT→PATCH 버그픽스 |
| `claude/add-kiwoom-ria-support-Rhc1C` | ✅ 머지 완료 (PR #28, 2026-03-24) | kiwoom-ria 스냅샷 지원 및 차트/합계 반영 |

---

## 6. 결정 사항 (전체 확정)

- [x] **ISA 계좌명**: `ISA(삼성증권)` 확정
- [x] **RIA 계좌명**: `RIA(키움)` — OBil과 완전 별개. RIA 개설 전(~2026-03-29) 빈값 표시
- [x] **PLAN_DATA 초기값**: DEFAULT_PLAN 구현 완료
- [x] **연금저축 납입 자동 계산**: 이체내역 없는 월은 0으로 처리
- [x] **Firebase 쓰기 권한**: `asset-data/` 상위 `.write: true` → pension-tracker/** PATCH 자동 허용 확인
- [x] **IRP1 납입 자동 계산**: invest[7]/[8] 델타 방식으로 MyAssetDashBD에서 구현 완료
- [x] **MyAssetDashBD Firebase 저장 방식 PUT→PATCH 수정 (2026-03-23)**: MyAssetDashBD가 `asset-data.json`에 PUT으로 저장할 때 `pension-tracker` 키를 포함하지 않아 데이터가 삭제되던 버그 수정 완료. PATCH로 변경해 `pension-tracker` 경로 보존. Pension-tracer 읽기 경로(`fetchAll` → `asset-data.json`)는 그대로 유지.
- [x] **RIA eval[10] 자동 연동 (2026-03-24)**: kiwoom-analyzer combined[].eval[10] 값을 Pension-tracer f_ria 필드에 자동 표시
