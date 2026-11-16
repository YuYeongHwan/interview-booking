# 국제기술봉사단 면접 예약

면접 시간대 예약 웹앱. 지원자 150명 이상, 대부분 모바일.
기간 2026-11-23~27, 13:20~17:00 20분 간격, 시간대당 4명, 1학번 1예약.

## 구조

브라우저(`public/index.html`) → Vercel 함수(`api/[action].js`) → Apps Script 웹앱(`apps-script/Code.gs` `doPost`) → 구글 시트(`예약명단` 탭)

- API: `POST /api/{getState|reserve|lookup|cancel|adminData}`, getState는 `GET`도 허용(CDN `s-maxage=3`). 나머지는 `no-store`.
- 프록시는 `{...payload, action, secret}`를 GAS에 POST. GAS는 302 → fetch가 따라가 JSON 수신.
- 응답 형식: `{ok:true, data}` / `{ok:false, error:"한글 메시지"}`. 사용자용 오류는 `fail_()`로 던진다.
- 비밀값: GAS 스크립트 속성 `API_SECRET`, `ADMIN_PASSWORD`. Vercel 환경변수 `GAS_URL`, `GAS_SECRET`. 코드/git에 넣지 말 것.
- 설정(날짜/시간/정원/OPEN_AT/CLOSE_AT): `Code.gs`의 `CONFIG`.

## 동시성 (중요)

- **예약·취소는 반드시 Apps Script `LockService` 안에서 읽기→검사→쓰기를 한다.**
- Vercel이나 다른 곳에서 Google Sheets API로 시트를 직접 쓰지 말 것. 경쟁 조건으로 정원 초과가 생긴다.
- 락 대기 15초 + Vercel 타임아웃 25초. reserve/cancel 타임아웃 시 "이미 처리됐을 수 있음" 안내.
- 변경 후 `node scripts/race-test.js`로 확인 (10건 동시 → 정확히 4건 성공).

## 시트 호환성

- 담당자가 시트를 직접 편집한다. 컬럼은 **헤더 이름**으로 찾고(`COL`), 빈 행은 무시한다.
- 날짜/시간은 `normDate_`/`normTime_`로 정규화(시트 자동 서식 대응). 새 행은 `@` 텍스트 서식(학번 앞자리 0 보존).
- `getState`는 인원 수만 반환. 개인정보 반환 금지.

## 로컬 / 테스트

- `MOCK=1 vercel dev`: `api/_mock.js`가 실제 `Code.gs`를 vm으로 실행(구글 서비스 스텁, 임시파일 저장, mkdir 락). 관리자 비번 `admin`.
- `node scripts/race-test.js` (BASE_URL 또는 GAS_URL+GAS_SECRET).

## 배포

- GAS 코드 수정: 붙여넣기(또는 `clasp push`) → **배포 관리 > 편집 > 새 버전** (URL 유지). 새 배포를 만들면 URL이 바뀐다.
- Vercel: GitHub push 시 자동 배포. 환경변수 변경 시 Redeploy.
