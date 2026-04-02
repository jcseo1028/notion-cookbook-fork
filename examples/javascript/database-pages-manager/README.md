# Database Pages Manager — 장마감 정리 페이지 자동화

Notion 데이터베이스(`DB_KStock_Today`)에 매일 작성하는 **"장마감 정리"** 페이지의 생성 및 시황 데이터 입력을 자동화하는 도구입니다.

## 기능

### Phase 1: 오늘의 페이지 자동 생성 ✅

- 오늘 날짜의 "YYYY-MM-DD 장마감 정리" 페이지가 DB에 없을 때 템플릿을 복제하여 자동 생성
- 템플릿 블록 구조를 재귀적으로 읽어 그대로 복제 (중첩 블록 포함)
- `template_mention` (@Today 등) → 원본 `plain_text`를 유지하여 텍스트 변환
- "기준일" 속성을 오늘 날짜로 자동 설정
- 이미 존재하는 페이지는 재사용 (휴지통/아카이브 페이지 감지)

### Phase 2: 시황 데이터 크롤링 & 자동 입력 ✅

- **해외지수**: 나스닥, S&P500, 다우 (네이버 금융 크롤링)
- **국내지수**: KOSPI, KOSDAQ (네이버 금융 크롤링)
- **상한가 종목**: 코스피/코스닥 상한가 종목 리스트 (네이버 금융 크롤링)
- **강세 테마**: 핀업 테마록 API 기반 상위 30개 테마 + 소속 종목
  - 상승률 15% 이상 테마만 문서에 추가
  - 해당 테마 내 상승률 15% 이상 종목을 child 블록으로 추가
- **테마 표 스크린샷**: Puppeteer로 핀업 테마록 페이지 캡처 → Notion 파일 업로드 → 이미지 블록 삽입
- **DB 링크 매칭**: 테마 DB / 종목 DB 페이지와 매칭하여 page mention 링크 생성
- 병렬 크롤링 + 부분 실패 허용 (개별 크롤러 실패 시 해당 섹션만 건너뜀)

### 기본 기능

- ✅ 데이터베이스 내 전체 페이지 목록 조회 (페이지네이션 지원)
- ✅ 페이지 제목, ID, 생성일, 수정일, URL 출력

## 사전 준비

1. [Notion Integration](https://www.notion.com/my-integrations) 을 생성하고 API 키를 복사합니다.
2. 조회할 데이터베이스에서 우측 상단 `...` → `Connections` → 생성한 Integration을 추가합니다.
3. 데이터베이스 URL에서 ID를 복사합니다.
   - URL 형식: `https://www.notion.so/{workspace}/{database_id}?v=...`
   - `database_id` 부분이 32자리 헥스 문자열입니다.

## 설정

```bash
# 의존성 설치
npm install

# 환경 변수 설정
cp example.env .env
```

`.env` 파일을 열고 값을 채워주세요:

```dotenv
NOTION_KEY=secret_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
NOTION_DATABASE_ID=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
NOTION_TEMPLATE_PAGE_ID=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx   # 템플릿 페이지 ID
NOTION_THEME_DB_ID=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx        # 테마 DB ID (선택)
NOTION_STOCK_DB_ID=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx        # 종목 DB ID (선택)
```

## 실행

```bash
# 기본: DB 페이지 목록 조회
npm run ts-run

# 장마감 정리 자동화 — 전체 (페이지 생성 + 크롤링 + 입력)
npm run auto

# 페이지 생성만
npm run auto:create

# 크롤링 + 데이터 입력만 (페이지 이미 존재 시)
npm run auto:crawl

# 테스트용: 크롤링만 하고 Notion 수정 안 함
npm run auto:dry-run

# 특정 날짜로 실행
npm run auto -- --date 2026-04-01
```

## 프로젝트 구조

```
database-pages-manager/
├── index.ts                  # DB 페이지 목록 조회 (기본)
├── auto-daily-page.ts        # ★ 장마감 정리 자동화 메인 스크립트
├── lib/
│   ├── notion-client.ts      # Notion SDK 초기화 & 공통 유틸
│   ├── page-creator.ts       # Phase 1: 템플릿 기반 페이지 생성
│   ├── page-updater.ts       # Phase 2: 크롤링 데이터 → 페이지 블록 삽입
│   ├── db-linker.ts          # Phase 2: 테마/종목 DB 페이지 매칭 & 링크
│   ├── screenshot.ts         # Phase 2: 테마록 스크린샷 캡처 + Notion 업로드
│   └── crawlers/
│       ├── naver-market.ts   # 네이버 시황 (해외/국내 지수)
│       ├── naver-upper.ts    # 네이버 상한가 종목
│       └── finup-theme.ts    # 핀업 테마록 API (강세 테마/종목)
├── types/
│   └── market-data.ts        # 시황 데이터 타입 정의
├── tmp/                      # 스크린샷 임시 파일
├── package.json
├── tsconfig.json
├── .env
└── DEVELOPMENT_PLAN.md       # 상세 개발 계획서
```

## 의존성

| 패키지                  | 용도                                            |
| ----------------------- | ----------------------------------------------- |
| `@notionhq/client` (v5) | Notion API SDK (dataSources.query, fileUploads) |
| `cheerio`               | HTML 파싱 (네이버 금융, EUC-KR 인코딩 처리)     |
| `puppeteer`             | Headless Chrome 스크린샷 캡처                   |
| `sharp`                 | 이미지 JPEG 압축 (5MB 이하)                     |
| `tsx`                   | TypeScript 런타임                               |
| `dotenv`                | 환경변수 로드                                   |

## 출력 예시

```
🚀 장마감 정리 페이지 자동화
=======================================================
  날짜: 2026-04-02
  모드: 전체

📊 데이터베이스 연결 중...
  ✅ Data Source 연결 완료

🔍 "2026-04-02 장마감 정리" 페이지 검색 중...
  ✅ 기존 페이지 발견: 2026-04-02 장마감 정리

─────────────────────────────────────────────────────────
📊 Phase 2: 시황 데이터 크롤링
─────────────────────────────────────────────────────────
  📸 핀업 테마록 스크린샷 캡처 중...
  ✅ 크롤링 결과 요약:
    해외지수: 3개 | 국내지수: 2개 | 상한가: N개 | 테마: 30개

✅ 완료!
```

## 추후 계획

- [ ] Phase 3: 스케줄링 (Windows Task Scheduler / cron)
- [ ] 에러 재시도 (exponential backoff)
- [ ] 실행 로그 파일 저장 (`logs/YYYY-MM-DD.log`)
- [ ] 테마명 fuzzy matching 개선 (Finup ↔ Notion DB 이름 차이 해소)
- [ ] 크롤링 데이터 로컬 백업 (JSON/CSV)
