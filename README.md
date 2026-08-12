# 살까 말까?

사고 싶은 물건과 가격을 입력하면 AI 판사가 무죄(합리적 소비)/유죄(낭비)를 판결해주는 개인용 실습 웹앱입니다.

## 실행 방법

프론트엔드는 빌드 도구가 필요 없는 순수 HTML/CSS/JS 정적 앱이지만, AI 판결 호출은 `api/verdict.js`(Vercel 서버리스 함수)를 거칩니다. 이 함수는 Vercel 환경에서만 동작하므로 로컬에서 AI 판결까지 확인하려면 Vercel CLI를 사용하세요.

**로컬 개발 (AI 판결 포함)**

```sh
npm i -g vercel        # 최초 1회
vercel dev
```

프로젝트 루트에 `.env` 파일을 만들고 아래처럼 키를 넣어두면 `vercel dev`가 자동으로 읽습니다. `.env`는 `.gitignore`에 포함되어 있어 커밋되지 않습니다.

```
ANTHROPIC_API_KEY=sk-ant-...
```

**정적 파일만 볼 때**: `index.html`을 더블클릭하거나 `python -m http.server 8000` 등으로 열어도 화면은 뜨지만, `/api/verdict`가 없어서 AI 판결 요청은 실패합니다. 판결 기록(Supabase) 조회/저장 기능은 정적 서버로도 정상 동작합니다.

## 배포 (Vercel)

1. [vercel.com](https://vercel.com)에서 이 GitHub 저장소(`salkka-malkka`)를 Import
2. 프로젝트 **Settings → Environment Variables**에 `ANTHROPIC_API_KEY` 추가 (본인의 Anthropic API 키 값)
3. Deploy

배포 후에는 사용자가 API 키를 직접 입력할 필요 없이 바로 재판을 시작할 수 있습니다.

## 데이터 저장 방식

- **AI 판결**: 브라우저는 Anthropic을 직접 호출하지 않고 `/api/verdict`(Vercel 서버리스 함수)를 호출합니다. 이 함수 안에서만 `ANTHROPIC_API_KEY` 환경변수를 읽어 Anthropic API를 호출하므로, 키는 클라이언트에 전혀 노출되지 않습니다.
- **판결 기록(마이페이지)**: Supabase(Postgres)의 `verdict_records` 테이블에 저장됩니다. Supabase 프로젝트 URL과 공개용 anon 키는 `app.js`에 하드코딩되어 있습니다(anon 키는 공개돼도 되는 값입니다).
- **모델 선택**: 이 브라우저의 `localStorage`에만 저장되는 단순 설정값입니다.

## ⚠️ 보안 안내 (반드시 읽어주세요)

이 앱은 **개인 실습용 패턴**입니다. 정식 서비스(SaaS)에는 적합하지 않습니다.

- **`/api/verdict`는 로그인/인증이 없는 공개 엔드포인트**입니다. 배포된 URL을 아는 사람은 누구나 요청을 보낼 수 있고, 그때마다 배포자의 Anthropic API 키로 과금됩니다. 요청량 제한(rate limit)이나 인증이 없으므로, 배포 URL을 불특정 다수에게 공유하지 마세요.
- **판결 기록(Supabase)**은 로그인/사용자 구분이 없는 단일 공개 테이블입니다. RLS 정책이 `anon` 키에 대해 읽기/쓰기/수정/삭제를 모두 허용하므로, `app.js`에 노출된 Supabase URL과 anon 키를 아는 사람은 누구나 모든 사용자의 기록을 보거나 지울 수 있습니다.
- **Anthropic API 키는 Vercel 프로젝트의 환경변수로만 관리하세요.** 코드에 직접 적거나 `.env`를 커밋하지 마세요.
- 실제 서비스를 만들 때는 Supabase Auth로 사용자를 구분하고 사용자별 RLS 정책을 적용하며, `/api/verdict`에도 인증/요청량 제한을 추가하세요.

## 기능

- 소비 입력 (품목명, 가격, 카테고리, 구매 이유)
- AI 판사의 무죄/유죄 판결 (검사 논고 / 변호인 변론 / 최종 판결 / 팩폭 명언)
- 판결 기록 및 통계 (누적 절약액, 무죄율) — Supabase에 저장되어 기기를 바꿔도 유지됩니다
- 판결 결과를 이미지로 공유

## 제외 범위 (MVP)

실제 결제 연동, 은행 계좌 연동, 소셜/배심원 기능, 재무 상담, 다국어 지원, 오프라인 모드는 포함하지 않습니다. 자세한 내용은 `PRD.md`를 참고하세요.
