# 📋 개발 계획: 장마감 정리 페이지 자동화

## 1. 프로젝트 개요

**목표:** Notion DB(`DB_KStock_Today`)에 매일 작성하는 **"장마감 정리"** 페이지의 생성 및 시황 데이터 입력을 자동화한다.

**현재 상태:**

- ✅ **Phase 1 완료** — 템플릿 기반 페이지 자동 생성 + 기준일 속성 설정
- ✅ **Phase 2 완료** — 시황 데이터 크롤링 & 자동 입력 (지수, 상한가, 테마, 스크린샷, DB 링크)
- 🚧 **Phase 3 미구현** — 스케줄링 & 안정화
- Notion SDK v5 (`@notionhq/client ^5.4.0`) + `tsx` 런타임
- Python 크롤러(`finup_theme_crawler.py`) → TypeScript 포팅 완료

---

## 2. 기능 요구사항

### Phase 1: 오늘의 페이지 자동 생성 ✅ 완료

| 항목     | 설명                                                                                   |
| -------- | -------------------------------------------------------------------------------------- |
| **조건** | 오늘 날짜의 "YYYY-MM-DD 장마감 정리" 페이지가 DB에 없을 때                             |
| **동작** | 템플릿 페이지의 블록 구조를 복제하여 새 페이지 생성 + "기준일" 속성을 오늘 날짜로 설정 |
| **결과** | DB에 `{오늘 날짜} 장마감 정리` 페이지가 추가됨                                         |

참고 : 이미 있으면 생성하지 않고 기존 페이지를 사용하여 시황 데이터 입력 단계로 넘어감

### Phase 2: 시황 데이터 크롤링 & 자동 입력 ✅ 완료

| 항목                | 설명                                                                        | 상태 |
| ------------------- | --------------------------------------------------------------------------- | ---- |
| **해외지수**        | 나스닥, S&P500, 다우 지수 / 등락폭 / 등락률                                 | ✅   |
| **국내지수**        | KOSPI, KOSDAQ 지수 / 등락폭 / 등락률                                        | ✅   |
| **상한가 종목**     | 코스피/코스닥 상한가 종목 리스트 (종목코드, 종목명, 현재가, 등락률, 거래량) | ✅   |
| **강세 테마**       | 핀업 테마록 API 기반 상위 30개 테마 + 소속 종목 (15%↑ 필터)                 | ✅   |
| **테마록 스크린샷** | Puppeteer `.contents01` 셀렉터 캐프처 → Notion fileUploads API 업로드       | ✅   |
| **DB 링크 매칭**    | 테마/종목 DB 페이지와 매칭하여 page mention 링크 생성                       | ✅   |
| **입력 위치**       | 오늘 "장마감 정리" 페이지의 해당 섹션 블록에 자동 작성                      | ✅   |

### Phase 3: 스케줄링 & 안정화

| 항목          | 설명                                                               |
| ------------- | ------------------------------------------------------------------ |
| **자동 실행** | 장 마감 시간(15:30) 이후 자동 실행 (cron / Windows Task Scheduler) |
| **에러 처리** | 크롤링 실패 시 재시도 / 부분 실패 허용                             |
| **로깅**      | 실행 결과 로그 파일 저장                                           |

---

## 3. 아키텍처 설계

### 3.1 모듈 구조

```
database-pages-manager/
├── index.ts                  # 기존: DB 조회 및 페이지 읽기 (유지)
├── auto-daily-page.ts        # ★ 메인 실행 스크립트 (Phase 1 + 2 통합)
├── lib/
│   ├── notion-client.ts      # Notion SDK 초기화 및 공통 유틸
│   ├── page-creator.ts       # Phase 1: 템플릿 기반 페이지 생성
│   ├── page-updater.ts       # Phase 2: 페이지 블록 수정/추가
│   ├── db-linker.ts          # Phase 2: 테마/종목 DB 페이지 매칭 & 링크 생성
│   ├── screenshot.ts         # Phase 2: 핀업 테마록 페이지 스크린샷 캡처 + 압축
│   └── crawlers/
│       ├── naver-market.ts   # 네이버 시황 (해외지수, 국내지수)
│       ├── naver-upper.ts    # 네이버 상한가 종목
│       └── finup-theme.ts    # 핀업 테마록 API (강세 테마/종목 + 표 이미지 캡처)
├── types/
│   └── market-data.ts        # 시황 데이터 타입 정의
├── data/                     # 크롤링 결과 CSV/JSON/이미지 백업
├── logs/                     # 실행 로그
├── package.json
├── tsconfig.json
├── .env
└── DEVELOPMENT_PLAN.md       # 이 문서
```

### 3.2 실행 흐름

```
auto-daily-page.ts 실행
│
├─ 1. 오늘 날짜의 "장마감 정리" 페이지 존재 확인
│     └─ DB 쿼리: title contains "YYYY-MM-DD 장마감 정리"
│
├─ 2. 페이지 확보
│     ├─ [있으면] 기존 페이지 사용 → 바로 3단계로
│     └─ [없으면] 템플릿 복제하여 새 페이지 생성
│           ├─ 템플릿 페이지 블록 조회 (fetchPageContent)
│           ├─ notion.pages.create() 로 새 페이지 생성
│           └─ notion.blocks.children.append() 로 블록 복제
│
├─ 3. 테마/종목 DB 페이지 맵 로드 (링크용)
│     ├─ 테마 DB (9052a6ee...) 전체 페이지 → Map<테마명, pageId>
│     └─ 종목 DB (44ca4f74...) 전체 페이지 → Map<종목코드/종목명, pageId>
│
├─ 4. 시황 데이터 크롤링 (병렬 실행)
│     ├─ [A] 해외지수 (네이버 finance.naver.com/world/)
│     ├─ [B] 국내지수 (네이버 finance.naver.com/sise/)
│     ├─ [C] 상한가 종목 (네이버 sise_upper.naver)
│     ├─ [D] 강세 테마 (핀업 stockdata.finup.co.kr API)
│     └─ [E] 핀업 테마록 전체 표 스크린샷 캡처 + 5MB 이하 압축
│
├─ 5. 크롤링 데이터에 DB 링크 매핑
│     ├─ 테마명 → 테마 DB pageId 매칭 → notionPageId 설정
│     └─ 종목코드/종목명 → 종목 DB pageId 매칭 → notionPageId 설정
│
├─ 6. 크롤링 결과 → 페이지에 자동 입력
│     ├─ "국내외 시장 지수" 섹션에 지수 데이터 입력
│     ├─ "주요 테마" 섹션에 강세 테마 목록 (DB 링크 포함) + 테마록 표 이미지 삽입
│     └─ "의 상한가" 섹션에 상한가 종목 (DB 링크 포함) 입력
│
├─ 7. 로컬 백업 (CSV/JSON/이미지 저장)
│
└─ 8. 실행 결과 로그 출력
```

---

## 4. 상세 구현 계획

### 4.1 Phase 1 — 페이지 자동 생성 (`page-creator.ts`)

#### 환경 변수 추가

```dotenv
# .env 에 추가
NOTION_TEMPLATE_PAGE_ID=xxxxxxxx                    # 템플릿 페이지 ID (빈 "장마감 정리" 페이지)
NOTION_THEME_DB_ID=9052a6eeb97444a0abf0dccfcda68abe  # 테마 DB ID (테마 페이지 링크용)
NOTION_STOCK_DB_ID=44ca4f74986f4bc2b57d6cfdf9a5e7d2  # 종목 DB ID (종목 페이지 링크용)
```

#### 핵심 함수

```typescript
// 1) 오늘 페이지 존재 확인 — 있으면 기존 페이지 반환, 없으면 null
async function findTodayPage(
  dataSourceId: string,
  dateStr: string
): Promise<PageObjectResponse | null>
// → dataSources.query + filter: title contains "{dateStr} 장마감 정리"

// 2) 템플릿 블록 조회
async function getTemplateBlocks(
  templatePageId: string
): Promise<BlockObjectResponse[]>
// → blocks.children.list (재귀) — 기존 fetchPageContent 재사용

// 3) 새 페이지 생성 + 블록 복제
async function createDailyPage(
  databaseId: string,
  title: string,
  templateBlocks: BlockObjectResponse[]
): Promise<PageObjectResponse>
// → pages.create() + blocks.children.append()

// 4) 오늘 페이지 확보 (통합: 있으면 재사용, 없으면 생성)
async function ensureTodayPage(
  dataSourceId: string,
  databaseId: string,
  dateStr: string
): Promise<PageObjectResponse>
// → findTodayPage() || createDailyPage()
```

#### 블록 복제 시 주의사항 (실제 구현)

- Notion API는 블록 복제 전용 엔드포인트가 없으므로, 템플릿 블록을 읽어서 `blocks.children.append()`로 재생성
- 블록 타입별 복제 payload 매핑: paragraph, heading_1~3, bulleted/numbered_list_item, to_do, toggle, quote, callout, code, divider, bookmark, image(external), embed, table_of_contents, breadcrumb
- `has_children`인 블록은 `fetchAllBlocks()`로 재귀적 조회 → depth 기반 트리 구조로 변환 → 중첩 children으로 생성
- **날짜 치환 없음**: 템플릿 블록의 텍스트를 원본 그대로 유지. `template_mention` (@Today 등)만 API로 생성 불가하므로 원본의 `plain_text`를 텍스트로 변환
- "기준일" 속성은 `pages.create()` 시 `date: { start: dateStr }` 로 설정 (템플릿이 자동으로 오늘 날짜 채움)
- 휴지통/아카이브 페이지 감지: `in_trash` 또는 `archived` 페이지는 검색에서 제외
- 블록 100개씩 배치 추가 (API 제한 대응, 350ms delay)

---

### 4.2 Phase 2 — 시황 크롤링 (`lib/crawlers/`)

#### 4.2.1 네이버 시황 크롤러 (TypeScript 포팅)

**의존성 추가:**

```json
{
  "cheerio": "^1.0.0", // HTML 파싱 (BeautifulSoup 대체)
  "node-fetch": "^3.3.0" // HTTP 요청 (또는 내장 fetch 사용, Node 18+)
}
```

> **참고:** Node.js v24 는 내장 `fetch` 지원. 별도 라이브러리 불필요할 수 있음.

**크롤러 모듈별 구현:**

| 모듈              | 소스                                          | 데이터                      |
| ----------------- | --------------------------------------------- | --------------------------- |
| `naver-market.ts` | `finance.naver.com/world/` + `/sise/`         | 해외지수 3종 + 국내지수 2종 |
| `naver-upper.ts`  | `finance.naver.com/sise/sise_upper.naver`     | 상한가 종목 리스트          |
| `finup-theme.ts`  | `stockdata.finup.co.kr/api` (POST)            | 강세 테마 + 소속 종목       |
| `finup-theme.ts`  | `finance.finup.co.kr/Lab/ThemeLog` (스크린샷) | 테마록 전체 표 이미지       |

**타입 정의 (`types/market-data.ts`):**

```typescript
export interface IndexData {
  name: string // "나스닥" | "S&P500" | "다우" | "KOSPI" | "KOSDAQ"
  value: number // 지수
  change: number // 등락폭
  changeRate: number // 등락률 (%)
}

export interface UpperLimitStock {
  market: "코스피" | "코스닥"
  code: string // 종목코드 (6자리)
  name: string // 종목명
  price: number // 현재가
  changeRate: number // 등락률
  volume: number // 거래량
  consecutive: number // 연속 상한가 일수
}

export interface ThemeData {
  name: string // 테마명
  changeRate: number // 테마 등락률
  score: number // 스코어
  notionPageId?: string // 테마 DB에서 매칭된 페이지 ID (있으면 링크 생성)
  stocks: ThemeStock[]
}

export interface ThemeStock {
  code: string
  name: string
  changeRate: number
  price: number
  volume: number
  marketCap: number
  notionPageId?: string // 종목 DB에서 매칭된 페이지 ID (있으면 링크 생성)
}

export interface DailyMarketData {
  date: string
  worldIndices: IndexData[]
  domesticIndices: IndexData[]
  upperLimitStocks: UpperLimitStock[] // 상한가 종목에도 notionPageId 활용
  hotThemes: ThemeData[]
  themeTableImagePath?: string // 핀업 테마록 전체 표 스크린샷 파일 경로 (<5MB)
}
```

#### 4.2.2 Notion 페이지 업데이트 (`page-updater.ts`)

크롤링 데이터를 Notion 블록으로 변환하여 해당 섹션에 삽입한다.

**핵심 로직:**

```
1. 오늘 페이지의 블록 목록 조회 (fetchPageContent)
2. 섹션별 heading_3 블록의 ID 탐색
   - "국내외 시장 지수" → 지수 데이터 입력 대상
   - "주요 테마"       → 강세 테마 텍스트 + 테마록 표 이미지 입력 대상
   - "의 상한가"       → 상한가 종목 입력 대상
3. 해당 heading 다음 블록에 데이터 블록 추가
   - blocks.children.append({ block_id: heading_block_id, children: [...] })
   또는
   - 기존 빈 블록 삭제 후 새 블록 추가
4. "주요 테마" 섹션에 테마록 표 이미지 삽입
   - 스크린샷 파일을 외부 호스팅 업로드 후 image 블록으로 삽입
   - 또는 Notion 파일 업로드 API 사용 (SDK v5 files.upload)
```

**지수 데이터 → 블록 변환 예시:**

```typescript
function buildIndexBlocks(
  indices: IndexData[]
): BlockObjectRequestWithoutChildren[] {
  return indices.map((idx) => ({
    type: "bulleted_list_item",
    bulleted_list_item: {
      rich_text: [
        {
          type: "text",
          text: {
            content:
              `${idx.name} : ${idx.value.toLocaleString()} , ` +
              `${idx.change > 0 ? "▲" : "▼"} ${Math.abs(idx.change).toFixed(2)} ` +
              `(${idx.changeRate > 0 ? "+" : ""}${idx.changeRate.toFixed(2)}%)`,
          },
        },
      ],
    },
  }))
}
```

**상한가 종목 → 블록 변환 예시:**

```typescript
function buildUpperLimitBlocks(
  stocks: UpperLimitStock[]
): BlockObjectRequestWithoutChildren[] {
  const kospiStocks = stocks.filter((s) => s.market === "코스피")
  const kosdaqStocks = stocks.filter((s) => s.market === "코스닥")

  return [
    paragraphBlock(`코스피 (${kospiStocks.length}개)`),
    ...kospiStocks.map((s) => stockBulletBlock(s)),
    paragraphBlock(`코스닥 (${kosdaqStocks.length}개)`),
    ...kosdaqStocks.map((s) => stockBulletBlock(s)),
  ]
}

// 종목 DB에 매칭 페이지가 있으면 page mention 링크, 없으면 plain text
function stockBulletBlock(s: UpperLimitStock) {
  const label = `${s.name}(${s.code}) ${s.price.toLocaleString()}원 ${s.changeRate > 0 ? "+" : ""}${s.changeRate}%`
  if (s.notionPageId) {
    return bulletBlockWithMention(
      s.notionPageId,
      s.name,
      ` (${s.code}) ${s.price.toLocaleString()}원`
    )
  }
  return bulletBlock(label)
}
```

#### 4.2.3 테마/종목 DB 연동 — 페이지 링크 (`lib/db-linker.ts`)

크롤링한 테마명·종목명을 기존 Notion DB에서 검색하여, 매칭되는 페이지가 있으면 **page mention 링크**로 삽입한다.

**대상 DB:**
| DB | ID | 용도 |
|----|------|------|
| **테마 DB** | `9052a6eeb97444a0abf0dccfcda68abe` | 테마명 → 테마 페이지 링크 |
| **종목 DB** | `44ca4f74986f4bc2b57d6cfdf9a5e7d2` | 종목명/종목코드 → 종목 페이지 링크 |

**핵심 로직:**

```typescript
import { Client, isFullPage } from "@notionhq/client"

// DB의 전체 페이지 제목→ID 맵을 캐싱 (세션 내 1회 조회)
interface PageMap {
  [titleOrCode: string]: string
} // name/code → page_id

// 1) DB 페이지 목록 → Map<이름, pageId> 생성
async function buildPageMap(dataSourceId: string): Promise<PageMap>
// → dataSources.query (전체 조회, 페이지네이션) → title 추출 → Map 생성

// 2) 크롤링 데이터에 notionPageId 매핑
async function enrichWithLinks(
  data: DailyMarketData,
  themeMap: PageMap,
  stockMap: PageMap
): Promise<DailyMarketData>
// → 테마명/종목명/종목코드로 Map에서 pageId 조회 → 매칭되면 notionPageId 설정
```

**page mention 블록 생성:**

```typescript
// rich_text에 page mention + 추가 텍스트를 조합
function bulletBlockWithMention(
  pageId: string,
  mentionText: string,
  suffix: string
) {
  return {
    type: "bulleted_list_item" as const,
    bulleted_list_item: {
      rich_text: [
        {
          type: "mention" as const,
          mention: { type: "page" as const, page: { id: pageId } },
        },
        {
          type: "text" as const,
          text: { content: suffix },
        },
      ],
    },
  }
}
// → Notion에서 "[종목명 링크] (코드) 가격" 형태로 표시됨
```

**매칭 전략:**
| 대상 | 검색 키 | 매칭 방식 |
|------|---------|----------|
| 테마 | 테마명 | 정확히 일치 (exact match) |
| 종목 | 종목코드 (6자리) | 정확히 일치 (우선) |
| 종목 | 종목명 | 종목코드 미매칭 시 이름으로 fallback |

**성능 고려:**

- 테마/종목 DB의 페이지가 수백~수천 개일 수 있으므로, 세션 시작 시 1회 전체 조회 후 Map에 캐싱
- DB 전체 조회는 `dataSources.query`를 페이지네이션으로 반복 호출 (page_size: 100)
- 조회한 Map은 메모리에 유지하여 각 종목/테마마다 개별 쿼리하지 않음

#### 4.2.4 핀업 테마록 표 이미지 캐프처 (`lib/screenshot.ts`) ✅ 구현 완료

핀업 테마록 전체 표(`https://finance.finup.co.kr/Lab/ThemeLog`)를 스크린샷으로 캐프처하여 Notion 페이지에 삽입한다.

**실제 구현:**

- **캐프처 셀렉터**: `.contents01` (탭 헤더 + 트리맵 차트 + 테마 테이블, ~1200x883px)
  - DOM 구조: `.contents01` > `.box_tab` (35px 헤더) + `#desc1` (1200x833) > `.box_cont` (855x833) > `.chart` > `#treemap` (855x410)
  - fallback: `.contents01` 못 찾으면 전체 페이지 캐프처
- **이미지 업로드**: Notion `fileUploads` API 사용 (외부 호스팅 불필요)
  1. `notion.fileUploads.create({ mode: "single_part" })` → upload URL 획득
  2. `notion.fileUploads.send()` → JPEG 파일 업로드
  3. 반환된 file upload ID로 `file_upload` 타입 이미지 블록 생성
- **압축**: sharp로 PNG → JPEG 변환 (quality 85→40, 폭 단계적 축소) → 5MB 이하 보장
- **결과**: 실제 캐프처 크기 ~0.15MB JPEG

**방법: Puppeteer (headless Chrome) 스크린샷**

```typescript
import puppeteer from "puppeteer"
import { statSync } from "fs"
import sharp from "sharp" // 이미지 리사이즈/압축

const MAX_IMAGE_SIZE = 5 * 1024 * 1024 // 5MB 제한

async function captureThemeTable(outputPath: string): Promise<string> {
  const browser = await puppeteer.launch({ headless: true })
  const page = await browser.newPage()
  await page.setViewport({ width: 1400, height: 900 })
  await page.goto("https://finance.finup.co.kr/Lab/ThemeLog", {
    waitUntil: "networkidle2",
  })

  // 1단계: PNG로 캡처
  const rawPath = outputPath.replace(/\.[^.]+$/, "_raw.png")
  const tableElement = await page.$("#themeLogTable") // 실제 선택자 확인 필요
  if (tableElement) {
    await tableElement.screenshot({ path: rawPath })
  } else {
    await page.screenshot({ path: rawPath, fullPage: true })
  }
  await browser.close()

  // 2단계: 5MB 이하로 압축 (PNG → JPEG 변환 + 품질 조절)
  await compressImage(rawPath, outputPath)
  return outputPath
}

/**
 * 이미지를 5MB 이하로 압축.
 * 1) JPEG 변환 (quality 85) → 대부분 이것만으로 충분
 * 2) 그래도 초과 시 → 리사이즈 (폭 축소) + 품질 하향 반복
 */
async function compressImage(
  inputPath: string,
  outputPath: string
): Promise<void> {
  let quality = 85
  let width: number | undefined = undefined

  while (quality >= 40) {
    const pipeline = sharp(inputPath)
    if (width) pipeline.resize({ width })
    await pipeline.jpeg({ quality }).toFile(outputPath)

    const size = statSync(outputPath).size
    if (size <= MAX_IMAGE_SIZE) {
      console.log(
        `  ✅ 이미지 압축 완료: ${(size / 1024 / 1024).toFixed(2)}MB (quality=${quality})`
      )
      return
    }

    // 초과 시: 품질 10 하향 + 폭 90%로 축소
    quality -= 10
    const meta = await sharp(inputPath).metadata()
    width = Math.round((width || meta.width || 1400) * 0.9)
  }

  console.warn(`  ⚠️ 이미지 최소 품질에도 5MB 초과 — 현재 크기로 사용`)
}
```

**이미지 크기 제한 전략:**
| 단계 | 처리 | 예상 크기 |
|------|------|----------|
| 캡처 | PNG 원본 (표 영역만) | ~2~8MB |
| 1차 압축 | JPEG quality=85 변환 | ~0.5~2MB |
| 2차 압축 | quality 하향 + 리사이즈 (필요 시) | <5MB 보장 |
| 최종 | outputPath에 JPEG 저장 | **< 5MB** |

> **참고:** `sharp`는 libvips 기반 고성능 이미지 처리 라이브러리. Puppeteer 캡처 후 PNG→JPEG 변환만으로 대부분 5MB 이하 달성 가능.

**Notion 이미지 삽입 방법 (실제 적용):**

| 방법                       | 상태       | 비고                                                     |
| -------------------------- | ---------- | -------------------------------------------------------- |
| **Notion fileUploads API** | ✅ 사용 중 | SDK v5 `fileUploads.create/send` → file_upload 타입 블록 |
| ~~외부 이미지 호스팅~~     | 미사용     | 추가 서비스 불필요                                       |
| ~~GitHub raw URL~~         | 미사용     | public repo 필요                                         |

```typescript
// Notion fileUploads API로 이미지 업로드 후 블록 생성
function fileUploadBlock(fileUploadId: string) {
  return {
    type: "image" as const,
    image: {
      type: "file_upload" as const,
      file_upload: { id: fileUploadId },
    },
  }
}
```

---

### 4.3 Phase 3 — 스케줄링 & 안정화

| 항목                       | 방법                                                                                    |
| -------------------------- | --------------------------------------------------------------------------------------- |
| **Windows 스케줄링**       | Task Scheduler에서 `npm run auto` 실행 (매일 15:40)                                     |
| **대안: cron (WSL/Linux)** | `40 15 * * 1-5 cd /path && npm run auto` (월~금)                                        |
| **에러 처리**              | 각 크롤러를 `try/catch`로 감싸 부분 실패 허용. 실패 시 해당 섹션은 "(크롤링 실패)" 표시 |
| **재시도**                 | 네트워크 에러 시 최대 3회 재시도 (exponential backoff)                                  |
| **로깅**                   | `logs/YYYY-MM-DD.log`에 타임스탬프 + 결과 기록                                          |
| **백업**                   | `data/` 폴더에 크롤링 원본 JSON/CSV 저장                                                |

---

## 5. package.json 스크립트 계획

```json
{
  "scripts": {
    "ts-run": "tsx index.ts",
    "auto": "tsx auto-daily-page.ts",
    "auto:create": "tsx auto-daily-page.ts --create-only",
    "auto:crawl": "tsx auto-daily-page.ts --crawl-only",
    "auto:dry-run": "tsx auto-daily-page.ts --dry-run"
  }
}
```

| 스크립트               | 설명                                                |
| ---------------------- | --------------------------------------------------- |
| `npm run auto`         | 전체 자동화 실행 (페이지 생성 + 크롤링 + 입력)      |
| `npm run auto:create`  | 페이지 생성만 실행                                  |
| `npm run auto:crawl`   | 크롤링 + 데이터 입력만 실행 (페이지 이미 존재 가정) |
| `npm run auto:dry-run` | 크롤링만 하고 Notion에는 쓰지 않음 (테스트용)       |

---

## 6. 필요 의존성 추가

```bash
npm install cheerio          # HTML 파싱
npm install puppeteer        # 핀업 테마록 표 스크린샷 캡처
npm install sharp            # 이미지 압축/리사이즈 (5MB 제한 대응)
npm install --save-dev @types/cheerio
```

> `node-fetch`는 Node.js v24 내장 `fetch` 사용으로 불필요.
> `axios` 대안도 가능하나 내장 fetch로 충분.
> `puppeteer`는 headless Chrome 기반 — 초기 설치 시 Chromium 다운로드 (~300MB) 필요.
> `sharp`는 libvips 기반 — 네이티브 바이너리 포함, 설치 시 자동 다운로드.

---

## 7. 개발 진행 상황

```
Phase 1: 페이지 자동 생성                       ██████████  ✅ 완료
  ├─ 1-1. 오늘 페이지 존재 확인 쿼리                ✅
  ├─ 1-2. 템플릿 블록 → 생성 payload 변환기         ✅
  ├─ 1-3. 페이지 생성 + 블록 복제 (원본 유지)      ✅
  └─ 1-4. "기준일" 속성 자동 설정                ✅

Phase 2: 시황 크롤링 & 입력                      ██████████  ✅ 완료
  ├─ 2-1. 타입 정의 + 크롤러 공통 유틸              ✅
  ├─ 2-2. 네이버 시황 크롤러 (해외/국내지수)     ✅
  ├─ 2-3. 네이버 상한가 크롤러                       ✅
  ├─ 2-4. 핀업 테마록 크롤러 (API 데이터)            ✅
  ├─ 2-5. 핀업 테마록 스크린샷 + Notion 업로드    ✅
  ├─ 2-6. 테마/종목 DB 연동 — 페이지 링크 매칭       ✅
  ├─ 2-7. 크롤링 데이터 → Notion 블록 입력          ✅
  └─ 2-8. 테마 15%↑ 필터 + child 종목 15%↑ 필터    ✅

Phase 3: 스케줄링 & 안정화                       ░░░░░░░░░░  🚧 미구현
  ├─ 3-1. CLI 옵션 + 스크립트 분리                   ✅ (구현 완료)
  ├─ 3-2. 에러 처리 (try/catch, 부분 실패 허용)     ✅ (구현 완료)
  ├─ 3-3. 재시도 (exponential backoff)              ❌
  ├─ 3-4. 로그 파일 저장                             ❌
  └─ 3-5. Task Scheduler 설정                        ❌
```

---

## 8. 기술적 고려사항

### 8.1 Notion API 제한

- **Rate Limit:** 3 requests/sec (평균). 블록 대량 추가 시 적절한 delay 필요
- **blocks.children.append:** 한 번에 최대 100개 블록 추가 가능
- **블록 depth:** 블록 중첩은 최대 2단계까지만 API로 생성 가능

### 8.2 Notion SDK v5 특이사항 (검증 완료)

- `databases.query` → `dataSources.query` (data_source_id 사용) — 정상 동작 확인
- title 필터는 dataSources.query에서 호환성 문제 있음 → 최근 20개 페이지 조회 후 제목 매칭 방식으로 구현
- `fileUploads.create` + `fileUploads.send` API 정상 동작 확인 (이미지 업로드)

### 8.3 크롤링 안정성 (구현 상태)

- 네이버 금융: EUC-KR 인코딩 처리 (`TextDecoder('euc-kr')` 사용). HTML 구조 변경 시 파싱 로직 깨질 수 있음
- 핀업 API: `https://stockdata.finup.co.kr/api`에 POST 요청 (`/ThemeCaptureChart`, `/ThemeRelationStock`). 비공식 API로 변경 가능성 있음
- 장 마감 직후(15:30~15:35)에는 데이터 미반영일 수 있으므로, 15:40 이후 실행 권장
- 각 크롤러는 `try/catch`로 부분 실패 허용 — 실패 시 해당 섹션만 건너뜀
- **테마 필터**: 상승률 15% 이상 테마만 문서에 추가, 해당 테마 내 15% 이상 종목을 child 블록으로 추가

### 8.4 Python 크롤러와의 관계

- 기존 Python 크롤러(`finup_theme_crawler.py`)의 로직을 TypeScript로 포팅
- Python 크롤러는 독립 실행용으로 유지하되, Notion 연동은 TypeScript 쪽에서 담당
- 향후 Python 크롤러를 subprocess로 호출하고 JSON 결과만 받는 방식도 대안

---

## 9. 페이지 템플릿 블록 구조 (참조)

현재 "장마감 정리" 페이지의 블록 구조:

```
### {날짜} 장마감 정리
### 보유종목 체크
  스윙
  ───────────────────
  • {종목 mention} ...       ← 종목 DB 페이지 링크 (자동 매칭 대상)
  단타
  • 자동 매매 종목
  • 프로그램 개선 사항
  • 체크해야 할 종목
### 단테 라이브
  시초가(단테)
  VIP(단테, 목요일만)
  종가(또사)
### 오늘의 인사이트
  ───────────────────
### {날짜} 국내외 시장 지수       ← ★ 자동 입력 대상 (Phase 2)
  • NASDAQ : {값}
  • S&P500 : {값}
  • KOSPI : {값}
  • KOSDAQ : {값}
  ───────────────────
### {날짜} 주요 테마              ← ★ 자동 입력 대상 (Phase 2)
  [핀업 테마록 표 이미지 <5MB]    ← ★ 스크린샷 삽입 (Phase 2)
  ▶ [테마DB 링크] 강세테마1 (+12.5%) ...  ← 테마 DB 매칭 시 링크
  ▶ [테마DB 링크] 강세테마2 (+10.3%) ...  ← 매칭 실패 시 plain text
  ───────────────────
### {날짜} 의 상한가              ← ★ 자동 입력 대상 (Phase 2)
  코스피
    • [종목DB 링크] 종목A ...    ← 종목 DB 매칭 시 링크
    • 종목B ...                   ← 매칭 실패 시 plain text
  코스닥
  ───────────────────
### {날짜} 의 관심종목
### 세력봉(500억 ↑)
### 스윙 발굴 종목
### 단테 추천 종목
  ───────────────────
```

---

## 10. 리스크 & 대안

| 리스크                      | 영향                       | 대안                                                         |
| --------------------------- | -------------------------- | ------------------------------------------------------------ |
| 네이버 금융 HTML 구조 변경  | 크롤링 실패                | 정기적 파싱 검증 + 네이버 API 대안 탐색                      |
| 핀업 API 폐쇄/변경          | 테마 데이터 수집 불가      | 네이버/다음 테마 페이지로 대체                               |
| 핀업 웹페이지 구조 변경     | 스크린샷 캡처 실패         | CSS 선택자 업데이트 / 전체 페이지 캡처 fallback              |
| 스크린샷 이미지 5MB 초과    | Notion 업로드 실패         | sharp로 JPEG 변환 + 품질/크기 단계별 축소                    |
| Puppeteer 환경 문제         | headless Chrome 실행 불가  | playwright 대안 / Docker 컨테이너 사용                       |
| Notion 이미지 업로드 실패   | 표 이미지 누락             | 외부 호스팅(S3/Imgur) fallback                               |
| 테마/종목 DB 페이지 미매칭  | 링크 대신 plain text 표시  | 정상 동작 (graceful fallback) — 신규 페이지 생성 옵션도 검토 |
| 테마/종목 DB 대량 조회 성능 | 초기 로드 시간 증가        | 캐싱 + 필요 시 타이틀 인덱스 DB 별도 관리                    |
| Notion API rate limit       | 블록 대량 추가 시 429 에러 | 배치 처리 + retry with backoff                               |
| 템플릿 구조 변경            | 섹션 탐색 실패             | heading 텍스트 매칭을 fuzzy하게 처리                         |
| SDK v5 breaking change      | 쿼리/생성 API 변경         | SDK 버전 고정 + 변경 로그 모니터링                           |
