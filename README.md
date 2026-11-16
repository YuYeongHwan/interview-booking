# 국제기술봉사단 면접 예약

- 면접: 2026-11-23(월) ~ 11-27(금), 13:20 ~ 17:00, 20분 간격(하루 11타임), 시간대당 4명, 1학번 1예약
- 구조: **브라우저 → Vercel(`/api/*`) → Apps Script 웹앱(`doPost`) → 구글 시트**
- 예약/취소의 동시성은 Apps Script `LockService`가 막습니다. 시트를 다른 경로(Sheets API 등)로 직접 쓰지 마세요.

```
apps-script/Code.gs         Apps Script 서버 (JSON API)
apps-script/appsscript.json 타임존·웹앱 설정
public/index.html           화면
api/[action].js             Vercel 프록시 함수
api/_mock.js                로컬 테스트용 mock (MOCK=1)
scripts/race-test.js        동시성 테스트
```

설정값(날짜·시간·정원·오픈/마감 시각)은 `apps-script/Code.gs` 맨 위 `CONFIG`에서 바꿉니다.
예약 오픈/마감: `OPEN_AT`, `CLOSE_AT` (예: `'2026-11-18T18:00:00+09:00'`, 비우면 제한 없음).

---

## 1. 구글 시트 만들기

1. 본인 구글 계정으로 [sheets.new](https://sheets.new) 접속 → 새 시트가 만들어집니다.
2. 제목을 `면접예약` 등으로 바꿉니다.

## 2. Apps Script 붙여넣기

**방법 A — 직접 붙여넣기 (추천)**

1. 시트 메뉴 **확장 프로그램 > Apps Script**.
2. 왼쪽 `Code.gs` 내용을 모두 지우고 `apps-script/Code.gs` 내용을 붙여넣기 → 저장(⌘S).
3. 왼쪽 **⚙ 프로젝트 설정** → "편집기에서 'appsscript.json' 매니페스트 파일 표시" 체크 →
   편집기에 생긴 `appsscript.json`을 `apps-script/appsscript.json` 내용으로 바꾸고 저장.
   (타임존 Asia/Seoul이 여기서 정해집니다.)

**방법 B — clasp**

```bash
npm i -g @google/clasp
clasp login
# 스크립트 ID: Apps Script 편집기 > ⚙ 프로젝트 설정 > 스크립트 ID
cd apps-script
echo '{"scriptId":"<스크립트ID>","rootDir":"."}' > .clasp.json
clasp push    # "manifest 덮어쓰기?" 물으면 y
```

## 3. setup() 실행과 스크립트 속성 설정

1. 편집기 위쪽 함수 선택에서 `setup` 선택 → **실행**.
2. 처음엔 권한 승인 창이 뜹니다: 계정 선택 → "고급" → "(안전하지 않음)으로 이동" → 허용.
   (내가 만든 스크립트라 뜨는 경고입니다.)
3. 실행 로그에 `API_SECRET` 값이 출력됩니다. **복사해 두세요** (5단계에서 씀).
   - 시트에 `예약명단`, `시간순명단` 탭과 헤더가 생깁니다.
4. **⚙ 프로젝트 설정 > 스크립트 속성 > 스크립트 속성 추가**
   - 속성 `ADMIN_PASSWORD`, 값: 관리자 비밀번호 (길고 추측 어렵게)
   - `API_SECRET`은 setup()이 이미 만들었습니다. 바꾸고 싶으면 여기서 수정 후 Vercel 값도 같이 바꾸세요.

## 4. 웹앱 배포

1. 편집기 오른쪽 위 **배포 > 새 배포**.
2. 톱니바퀴 → 유형 **웹 앱**.
3. 실행 사용자: **나**, 액세스 권한: **모든 사용자** → 배포.
4. 나오는 **웹 앱 URL**(`https://script.google.com/macros/s/…/exec`)을 복사.
5. 확인: 그 URL을 브라우저로 열어 `{"ok":true}`가 보이면 정상.

## 5. Vercel 배포

**방법 A — GitHub 연동**

1. 이 폴더를 GitHub 저장소에 push (`.env`는 `.gitignore`로 제외됨).
2. [vercel.com/new](https://vercel.com/new) → 저장소 Import. Framework는 **Other**, 나머지 기본값.
3. **Environment Variables**에 등록:
   - `GAS_URL` = 4단계의 웹 앱 URL
   - `GAS_SECRET` = 3단계의 API_SECRET
4. Deploy. 환경변수를 나중에 바꿨다면 **Deployments > Redeploy** 해야 반영됩니다.

**방법 B — vercel CLI**

```bash
npm i -g vercel
vercel login
vercel link
vercel env add GAS_URL production
vercel env add GAS_SECRET production
vercel --prod
```

**배포 후 동시성 확인 (권장)**

```bash
BASE_URL=https://<내도메인>.vercel.app node scripts/race-test.js
```

`PASS ✅`가 나오면 정상입니다. 테스트 예약(학번 `9999xxxx`)은 끝나면 자동 취소됩니다.
(`CLOSE_AT`이 지났거나 `OPEN_AT` 전이면 테스트가 실행되지 않습니다.)

## 6. 담당자에게 시트 공유

1. 시트 오른쪽 위 **공유** → 담당자 구글 계정 이메일 입력 → 권한 **편집자** → 전송.
2. 담당자는 시트에서 직접 조회·수정할 수 있고, **파일 > 다운로드 > Microsoft Excel(.xlsx)**로 받습니다.
3. 웹 관리자 화면의 "엑셀 다운로드" 링크도 공유받은 계정으로 로그인한 브라우저에서 열립니다.

담당자가 시트를 직접 고칠 때:
- 열 순서를 바꾸거나 열(예: `비고`)을 추가해도 괜찮습니다. **헤더 이름**(예약일시, 면접날짜, 요일, 면접시간, 이름, 학번, 학과, 연락처)만 바꾸지 마세요.
- 행을 지우면 그 예약은 취소됩니다. 빈 행이 생겨도 무시됩니다.
- `시간순명단` 탭은 관리자 화면 조회 때마다(또는 시트 메뉴 **면접예약 > 시간순 명단 갱신**) 새로 만들어집니다. 여기서 고친 내용은 덮어써지니 수정은 `예약명단` 탭에서 하세요.

## 7. Apps Script 코드를 고친 뒤 (URL 유지)

**새 배포를 만들면 URL이 바뀝니다.** 같은 URL을 유지하려면:

1. 코드 저장 → **배포 > 배포 관리**.
2. 기존 배포 선택 → ✏ 편집 → 버전: **새 버전** → 배포.

URL이 같으니 Vercel 설정은 그대로 두면 됩니다.

## 8. 테스트 데이터 삭제

- 시트 `예약명단` 탭에서 테스트 행을 선택 → 우클릭 → **행 삭제**. (헤더 1행은 남기세요)
- race-test가 남긴 행은 학번이 `9999`로 시작합니다.
- 전부 지우려면 2행부터 마지막 행까지 선택해서 삭제하면 됩니다.
- 관리자 비밀번호를 10번 틀려 잠겼다면 10분 기다리면 풀립니다.

---

## 로컬 개발

```bash
cp .env.example .env    # MOCK=1 로 두면 GAS 없이 동작
npm i -g vercel && vercel dev
# 다른 터미널
node scripts/race-test.js     # 기본 BASE_URL=http://localhost:3000
```

- mock은 `apps-script/Code.gs`를 그대로 실행하고 구글 서비스만 흉내 냅니다. 데이터는 OS 임시폴더의 `interview-booking-mock.json`에 저장됩니다.
- mock 관리자 비밀번호: `admin`
- 실제 Apps Script를 직접 테스트: `GAS_URL=… GAS_SECRET=… node scripts/race-test.js`
