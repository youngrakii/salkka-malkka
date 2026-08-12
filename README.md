# 살까 말까?

사고 싶은 물건과 가격을 입력하면 AI 판사가 무죄(합리적 소비)/유죄(낭비)를 판결해주는 개인용 실습 웹앱입니다.

## 실행 방법

빌드 도구가 필요 없는 순수 HTML/CSS/JS 정적 앱입니다.

**권장: 로컬 정적 서버로 실행**

```sh
# Node.js가 있다면
npx serve .

# Python이 있다면
python -m http.server 8000
```

그 후 브라우저에서 `http://localhost:8000` (또는 안내된 포트)에 접속하세요.

**`index.html`을 직접 더블클릭해서 열어도 대부분의 브라우저에서 동작합니다.** AI 판결 호출은 이미 배포된 Supabase Edge Function을 통해 이뤄지므로, 별도 서버 실행 없이 정적 파일만으로 전체 기능(재판 + 기록 저장)이 동작합니다.

## 데이터 저장 방식

- **AI 판결**: 브라우저는 Anthropic을 직접 호출하지 않고 Supabase Edge Function `verdict`(`supabase/functions/verdict`)를 호출합니다. 이 함수 안에서만 `ANTHROPIC_API_KEY` secret을 읽어 Anthropic API를 호출하므로, 키는 클라이언트에 전혀 노출되지 않습니다. 사용자가 API 키를 따로 입력할 필요가 없습니다.
- **판결 기록(마이페이지)**: Supabase(Postgres)의 `verdict_records` 테이블에 저장됩니다. Supabase 프로젝트 URL과 공개용 anon 키는 `app.js`에 하드코딩되어 있습니다(anon 키는 공개돼도 되는 값입니다).
- **모델 선택**: 이 브라우저의 `localStorage`에만 저장되는 단순 설정값입니다.

## ⚠️ 보안 안내 (반드시 읽어주세요)

이 앱은 **개인 실습용 패턴**입니다. 정식 서비스(SaaS)에는 적합하지 않습니다.

- **`verdict` Edge Function은 로그인/사용자별 인증이 없는 엔드포인트**입니다. Supabase anon 키(공개용, `app.js`에 노출됨)만 있으면 누구나 호출할 수 있고, 그때마다 프로젝트 소유자의 Anthropic API 키로 과금됩니다. 요청량 제한이 없으므로, 이 앱을 다수에게 공개 배포하지 마세요.
- **판결 기록(Supabase)**은 로그인/사용자 구분이 없는 단일 공개 테이블입니다. RLS 정책이 `anon` 키에 대해 읽기/쓰기/수정/삭제를 모두 허용하므로, 노출된 Supabase URL과 anon 키를 아는 사람은 누구나 모든 사용자의 기록을 보거나 지울 수 있습니다.
- **Anthropic API 키는 Supabase Edge Function의 secret으로만 관리하세요.** (`supabase secrets set ANTHROPIC_API_KEY=...`) 코드에 직접 적지 마세요.
- 실제 서비스를 만들 때는 Supabase Auth로 사용자를 구분하고 사용자별 RLS 정책을 적용하며, `verdict` 함수에도 인증/요청량 제한을 추가하세요.

## 기능

- 소비 입력 (품목명, 가격, 카테고리, 구매 이유)
- AI 판사의 무죄/유죄 판결 (검사 논고 / 변호인 변론 / 최종 판결 / 팩폭 명언)
- 판결 기록 및 통계 (누적 절약액, 무죄율) — Supabase에 저장되어 기기를 바꿔도 유지됩니다
- 판결 결과를 이미지로 공유

## 제외 범위 (MVP)

실제 결제 연동, 은행 계좌 연동, 소셜/배심원 기능, 재무 상담, 다국어 지원, 오프라인 모드는 포함하지 않습니다. 자세한 내용은 `PRD.md`를 참고하세요.
