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
    toss-*:          { val, date }
    ...
    ← ISA 없음, RIA 없음
  kiwoom/
    combined: [
      { month: "YYYY-MM", date: "YYYY-MM-DD", eval: [...], invest: [...] }
      ← eval[] = 월별 평가금액(잔액)
      ← invest[3] = 연금저축 누적투자금 (이체내역 모달로 관리)
    ]
  todos: [...]
  goal: { name, target, finName, finTarget }
```

### 현재 Pension-tracer 한계
- localStorage에만 월별 실적 저장 (브라우저 종속)
- ISA 잔액 자동 연동 없음 (수동 입력만)
- RIA 잔액 = `kiwoom-obil` 로 잘못 맵핑됨 → **OBil과 RIA는 완전히 별개 계좌**, 분리 필요
- PLAN_DATA 하드코딩 없음 (계획 vs 실적 비교 기능 없음)
- 납입 이력 Firebase 미연동 (입력 후 사라짐)
- UI 단순 입력폼 수준 → 완전 재구축 필요

### 용어 정의

| 용어 | 의미 | 비고 |
|------|------|------|
| **잔액 = 평가금액** | 현재 계좌 가치 (원금 + 미실현 수익) | 동일 개념, 혼용 가능 |
| **납입액** | 해당 월에 실제로 납입한 금액 | 원금만, 수익 미포함 |
| **누적투자금** | 지금까지 납입한 원금 합계 | `invest[]` 기준 |
| **OBil** | 키움 OBil 계좌 (`kiwoom-obil`) | RIA와 완전 별개 계좌 |
| **RIA** | RIA 별도 계좌 (`ria`) | OBil과 완전 별개 계좌, 개설 후 1년 의무 유지 |
| **ISA 연간 한도** | ISA 연간 납입 한도 2,000만원 (1/1~12/31) | RIA 이체 시 잔여 한도 계산 필요 |
| **ISA 월납입** | VOO 매도 자금으로 매월 25만원 납입 | RIA 이체 시점에 연말까지 홀딩 가능 |
| **양도차익 (gain)** | VOO 매도 시 발생한 수익 (매도가 - 취득가) | 연간 250만원까지 기본공제 |
| **잔여 공제 한도** | 250만원 - 연간 누적 양도차익 | 이 금액 내에서 추가 매도 시 세금 없음 |
| **합산 납입 한도** | 개인연금저축 + IRP1 연간 납입 합계 최대 1,800만원 | 법정 한도, 1/1~12/31 기준 |
| **납입 계획** | 개인연금저축 연 1,500만원 + IRP1 연 300만원 = 연 1,800만원 | 월 기준: 연금저축 125만 + IRP1 25만 |

### RIA → ISA 이체 전략

```
RIA 계좌
  - 개설 후 1년 의무 유지 조건
  - 만기 도래 시 ISA 계좌로 이체 계획

이체 시점 판단 기준:
  이체 가능 금액 = ISA 연간 한도(2,000만원) - 당해 연간 누적 ISA 납입액
  → 잔여 한도만큼만 당해 연도에 이체, 나머지는 차년도로 이월

VOO 매도 자금 ISA 월납입 25만원 홀딩 조건:
  - RIA → ISA 이체로 당해 ISA 한도를 상당 부분 소진한 경우
  - 이체 시점부터 당해 연말(12/31)까지 VOO 매도 자금 ISA 납입 중단(홀딩)
  - 차년도에 남은 RIA 잔액 ISA 이전 완료 후
  - 남은 ISA 연간 한도(2,000만원 - 이전금액) 내에서 월 25만원 납입 재개

연도별 ISA 납입 흐름 예시:
  이체 연도:  [RIA 이체금액] + [VOO 25만×이체 전 개월수] ≤ 2,000만원
  차년도:     [남은 RIA 이체] + [VOO 25만×재개 이후 개월수] ≤ 2,000만원
```

---

## 2. 목표

> **One Source, Multi Use**
> MyAssetDashBD가 실시간 잔액의 Master DB
> Pension-tracer가 연금 전략 계획/실적 분석 전문 앱

- Firebase를 단일 데이터 소스로 읽기+쓰기
- ISA/RIA 잔액을 MyAssetDashBD에서도 관리
- 납입 이력, 계획 데이터, VOO 매도 이력을 Firebase에 영구 저장
- 계획 대비 실적 분석, 세액공제 최적화 시각화

---

## 3. Firebase 데이터 구조 (변경사항)

### MyAssetDashBD에서 추가할 경로
```
asset-data/
  state/
    isa:  { val: number(원), date: "YYYY-MM-DD" }  ← 신규 추가
    ria:  { val: number(원), date: "YYYY-MM-DD" }  ← 신규 추가
```

### Pension-tracer에서 쓸 신규 경로
```
asset-data/
  pension-tracker/                               ← 신규 섹션
    plan/
      "2026-01": {
        pension_annual:  15000000,  ← 연금저축 연간 납입 계획(원) — 월 1,250,000원
        irp1_annual:     3000000,   ← IRP1 연간 납입 계획(원) — 월 250,000원
        combined_annual_limit: 18000000, ← 개인연금저축 + IRP1 합산 납입 한도(원, 법정)
        pension_limit:  6000000,   ← 연금저축 세액공제 한도(원)
        irp_limit:      9000000,   ← IRP 합산 세액공제 한도(원)
        isa_annual_limit: 20000000, ← ISA 연간 납입 한도(원, 1/1~12/31)
        pension_monthly: 1250000,  ← 연금저축 월 납입 계획(원) = 1500만 / 12
        irp_monthly:    250000,    ← IRP1 월 납입 계획(원) = 300만 / 12
        isa_monthly:    250000,    ← ISA 월 납입 계획(원) = VOO 매도 자금 25만원
        voo_annual_limit: 2500000, ← 양도소득세 연간 기본공제 한도(원) — 1/1~12/31 기준
        tax_rate:       0.165,     ← 세액공제율
      }
      ...
    contributions/
      irp/  { "2026-03": 100000, "2026-02": 100000, ... }
      isa/  { "2026-03": 0, ... }
    voo/
      "2026": { sold: 0, gain: 0 }   ← 연간 VOO 매도금액 / 양도차익 (1/1~12/31 누적)
      "2025": { sold: 1800000, gain: 340000 }
      ← gain이 250만원 초과 시 초과분에 대해 양도소득세 22% 과세
      ← 따라서 연내 gain 잔여 한도(250만원 - 누적 gain)를 항상 표시해야 함
    records/
      "2026-03": {                   ← 월별 실적 스냅샷 (로컬저장 대신)
        pension: 32396693,
        irp1: ..., irp2: ...,
        isa: ..., overseas: ..., ria: ...,
        c_pension: 500000,           ← 연금저축 납입액 (kiwoom delta로 자동)
        c_irp: 100000,
        c_isa: 0,
        tax_refund: 0,
        savedAt: "ISO timestamp"
      }
```

**연금저축 납입액**은 별도 저장 없이 `kiwoom.combined[].invest[3]` 월간 델타로 자동 계산

---

## 4. 작업 목록

### Phase 1: MyAssetDashBD — ISA / RIA 모달 추가

> 기존 동작에 영향 없이 state에 키만 추가

| # | 작업 | 파일 | 주의사항 |
|---|------|------|---------|
| 1-1 | ISA 스냅샷 카드 추가 (pension-snap 섹션) | `js/render.js` | `PENSION_SNAP_KEYS`에 `pension-isa` 추가 또는 별도 섹션 |
| 1-2 | ISA 잔액 입력 모달 추가 | `index.html`, `js/modal.js` | 연금저축 모달 패턴 복사 |
| 1-3 | RIA 잔액 입력 모달 추가 | `index.html`, `js/modal.js` | 키움 OBil과 별개로 `state.ria` 저장 |
| 1-4 | `config.js`에 ISA/RIA 키 등록 | `js/config.js` | `MANUAL_KEYS`에 추가 |
| 1-5 | Firebase PUT 페이로드에 자동 포함 확인 | `js/firebase.js` | state가 통째로 PUT되므로 별도 작업 불필요 |

**ISA 모달 동작:**
1. 버튼 클릭 → 모달 오픈
2. 잔액 입력 (원 단위)
3. 적용 클릭 → `state['isa'] = { val, date: today }` → `scheduleGasSync_()`

**RIA 모달 동작:**
- 동일 패턴, key = `ria`
- 기존 `kiwoom-obil`(OBil) 과는 별개 계정으로 표시

---

### Phase 2: Pension-tracer — 완전 재구축

#### 2-1. 파일 구조
```
Pension-tracer/
  index.html          ← 메인 앱 (단일 HTML)
  js/
    config.js         ← 상수, Firebase URL
    firebase.js       ← Firebase 읽기/쓰기
    render.js         ← UI 렌더링
    modal.js          ← 모달 로직
  css/
    style.css         ← 스타일
```

#### 2-2. 새 UI 구성 (섹션별)

```
┌─────────────────────────────────────────┐
│  HEADER: 연금전략 트래커 | 마지막 동기화 |
├─────────────────────────────────────────┤
│  [Firebase 불러오기]  [월 선택]  [저장]  │
├─────────┬──────────┬──────────┬─────────┤
│연금저축  │  IRP     │  ISA     │해외/RIA │
│잔액카드  │ 잔액카드  │ 잔액카드  │잔액카드 │
│납입진행  │ 납입진행  │ 납입진행  │        │
├─────────┴──────────┴──────────┴─────────┤
│  납입 현황 (월별 납입 입력 모달 버튼)     │
│  연금저축 [자동] | IRP [입력▼] | ISA [입력▼] │
├─────────────────────────────────────────┤
│  세금 / VOO 섹션                                      │
│  VOO 매도 현황 (연간) | 누적 양도차익 | 잔여 공제 한도 │
│  (기본공제 250만원 - 누적 양도차익 = 잔여 가능 금액)   │
├─────────────────────────────────────────┤
│  계획 대비 실적 테이블 (YYYY년)           │
│  항목 | 계획 | 실적 | 달성률             │
├─────────────────────────────────────────┤
│  월별 실적 이력 (Firebase records)       │
└─────────────────────────────────────────┘
```

#### 2-3. 모달 목록

| 모달 | 트리거 | 동작 |
|------|--------|------|
| IRP 납입 입력 | "IRP 납입 입력" 버튼 | 월 + 금액 입력 → `pension-tracker/contributions/irp/{YYYY-MM}` PATCH |
| ISA 납입 입력 | "ISA 납입 입력" 버튼 | 월 + 금액 입력 → `pension-tracker/contributions/isa/{YYYY-MM}` PATCH |
| VOO 매도 입력 | "VOO 매도 입력" 버튼 | 연도 + 매도금액 + 양도차익 → `pension-tracker/voo/{YYYY}` PATCH |
| 계획 데이터 관리 | "계획 편집" 버튼 | 월별 계획 JSON 편집 → `pension-tracker/plan` PUT |
| 월 저장 | "저장" 버튼 | 현재 폼 데이터 → `pension-tracker/records/{YYYY-MM}` PATCH |

#### 2-4. Firebase 읽기 흐름

```
loadFromFirebase()
  ↓ GET /asset-data.json
  ↓ state.*           → 잔액 카드 표시
  ↓ kiwoom.combined   → 연금저축 납입 델타 계산
  ↓ pension-tracker/contributions/* → 납입 이력 렌더
  ↓ pension-tracker/voo/*           → VOO 현황 렌더
  ↓ pension-tracker/plan/*          → 계획 데이터 로드
  ↓ pension-tracker/records/*       → 월별 이력 테이블 렌더
```

#### 2-5. Firebase 쓰기 방식

- **PATCH** 방식 사용 (PUT 전체 덮어쓰기 금지)
- 경로별 개별 PATCH: `FIREBASE_URL/asset-data/pension-tracker/contributions/irp.json`
- MyAssetDashBD의 `state`, `kiwoom` 데이터는 **읽기 전용** (쓰지 않음)

---

## 5. 브랜치 전략

| 레포 | 브랜치 |
|------|--------|
| Pension-tracer (jungukeu-ctrl/Pension-tracer) | `claude/auto-sync-pension-data-iqIFx` |
| MyAssetDashBD (jungukeu-ctrl/MyAssetDashBD) | `claude/auto-sync-pension-data-iqIFx` (동일 브랜치명으로 신규 생성) |

---

## 6. 작업 순서

1. **[MyAssetDashBD]** `config.js` — ISA/RIA 키 상수 추가
2. **[MyAssetDashBD]** `index.html` — ISA/RIA 모달 HTML 추가
3. **[MyAssetDashBD]** `js/modal.js` — ISA/RIA 모달 로직 추가
4. **[MyAssetDashBD]** `js/render.js` — ISA/RIA 스냅샷 카드 렌더 추가
5. **[MyAssetDashBD]** 커밋 & 푸시
6. **[Pension-tracer]** `css/style.css` — 새 디자인 스타일
7. **[Pension-tracer]** `js/config.js` — 상수, Firebase URL
8. **[Pension-tracer]** `js/firebase.js` — 읽기(GET) + 쓰기(PATCH) 로직
9. **[Pension-tracer]** `js/modal.js` — 모달 4종 로직
10. **[Pension-tracer]** `js/render.js` — 전체 UI 렌더링
11. **[Pension-tracer]** `index.html` — 새 UI (기존 완전 교체)
12. **[Pension-tracer]** 커밋 & 푸시

---

## 7. 결정 필요 사항 (구현 전 확인)

- [ ] **ISA 계좌명**: MyAssetDashBD에서 어떤 이름으로 표시? (예: `ISA (삼성증권)`)
- [ ] **RIA 계좌명**: `RIA (키움)` vs `RIA/OBil` — OBil과 완전히 별개로 볼 것인가?
- [ ] **PLAN_DATA 초기값**: 첫 실행 시 계획 데이터가 없으면 기본값 제공할 것인가?
- [ ] **연금저축 납입 자동 계산**: `kiwoom.combined`에 이체내역이 없는 월은 0으로 처리?
- [ ] **Firebase 쓰기 권한**: 현재 Firebase Rules가 `asset-data/pension-tracker/**` PATCH 허용하는가?
