# Database Pages Manager

특정 Notion 데이터베이스에 포함된 페이지 목록을 조회하고, 추후 페이지 자동 수정 기능을 추가할 예정인 예제입니다.

## 기능

- ✅ 데이터베이스 내 전체 페이지 목록 조회 (페이지네이션 지원)
- ✅ 페이지 제목, ID, 생성일, 수정일, URL 출력
- 🔜 특정 페이지 자동 수정 (추후 구현 예정)

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
```

## 실행

```bash
npm run ts-run
```

## 출력 예시

```
🚀 Database Pages Manager
=======================================================

📋 데이터베이스 페이지 목록 조회 중...

  총 3개 페이지를 찾았습니다.

  ─────────────────────────────────────────────────
  1. 프로젝트 A
     ID: 12345678-1234-1234-1234-123456789abc
     생성: 2026. 3. 15. | 수정: 2026. 4. 1.
     URL: https://www.notion.so/...
  ─────────────────────────────────────────────────
  2. 프로젝트 B
     ...

✅ 완료!
```

## 추후 계획

- [ ] 특정 조건의 페이지 필터링
- [ ] 페이지 프로퍼티 자동 수정 (`notion.pages.update`)
- [ ] 페이지 콘텐츠(블록) 수정
- [ ] 벌크 업데이트 지원
