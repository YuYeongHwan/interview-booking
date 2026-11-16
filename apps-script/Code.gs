/***** ========== 설정 (여기만 수정하면 됨) ========== *****/
const CONFIG = {
  TITLE: '국제기술봉사단 면접 일정 예약',
  DATES: ['2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27'],
  START: '13:20',          // 첫 면접 시작
  END: '17:00',            // 마지막 면접 종료
  INTERVAL_MIN: 20,        // 간격(분)
  CAPACITY: 4,             // 시간대당 정원
  // 각 날짜 마지막에 붙는 추가 칸. key는 시트 '면접시간' 열에 저장되는 값. 필요 없으면 null.
  EXTRA_SLOT: { key: '17:00 이후', label: '17:00 이후 가능', unlimited: true },
  OPEN_AT: '',             // 예약 오픈 시각. 예: '2026-11-18T18:00:00+09:00' (비우면 즉시 오픈)
  CLOSE_AT: '',            // 예약 마감 시각. 예: '2026-11-21T23:59:59+09:00' (비우면 마감 없음)
  SHEET: '예약명단',
  SORTED_SHEET: '시간순명단'
};
// 비밀값(API_SECRET, ADMIN_PASSWORD)은 코드가 아니라
// [프로젝트 설정 > 스크립트 속성]에 저장한다. setup() 참고.
/***** ============================================== *****/

// 컬럼은 '헤더 이름'으로 찾는다. 담당자가 열 순서를 바꾸거나 열을 추가해도 동작한다.
const COL = { ts: '예약일시', date: '면접날짜', dow: '요일', time: '면접시간', name: '이름', sid: '학번', major: '학과', phone: '연락처' };
const HEADER = Object.keys(COL).map(k => COL[k]);
const DOW = ['일', '월', '화', '수', '목', '금', '토'];
const RETRY_MSG = '일시적인 오류가 발생했습니다. 잠시 후 다시 시도해주세요.';

/* ---------- JSON API 진입점 ---------- */
// body: { action, secret, ...payload } → { ok:true, data } | { ok:false, error }
const ACTIONS = {
  getState: () => getState(),
  reserve: b => reserve(b),
  lookup: b => lookup(b.studentId, b.phone),
  cancel: b => cancel(b.studentId, b.phone),
  adminData: b => adminData(b.password)
};

function doPost(e) {
  let res;
  try {
    let body;
    try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); }
    catch (_) { fail_('잘못된 요청입니다.'); }
    const secret = PropertiesService.getScriptProperties().getProperty('API_SECRET');
    if (!secret || body.secret !== secret) fail_('서버 설정 오류입니다. 담당자에게 문의해주세요.');
    if (!Object.prototype.hasOwnProperty.call(ACTIONS, body.action)) fail_('잘못된 요청입니다.');
    res = { ok: true, data: ACTIONS[body.action](body) };
  } catch (err) {
    if (err && err.userMessage) res = { ok: false, error: err.userMessage };
    else { console.error(err && err.stack || err); res = { ok: false, error: RETRY_MSG }; }
  }
  return ContentService.createTextOutput(JSON.stringify(res)).setMimeType(ContentService.MimeType.JSON);
}

// 배포 확인용: /exec URL을 브라우저로 열어 {"ok":true} 가 보이면 정상
function doGet() {
  return ContentService.createTextOutput(JSON.stringify({ ok: true })).setMimeType(ContentService.MimeType.JSON);
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu('면접예약')
    .addItem('시간순 명단 갱신', 'refreshSortedSheet')
    .addToUi();
}

/* 최초 1회 실행: 시트/헤더 생성, API_SECRET 자동 생성, 설정 안내를 실행 로그에 출력 */
function setup() {
  sheet_();
  refreshSortedSheet();
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('API_SECRET')) props.setProperty('API_SECRET', Utilities.getUuid() + Utilities.getUuid());
  Logger.log('API_SECRET (Vercel 환경변수 GAS_SECRET 에 그대로 붙여넣기):\n' + props.getProperty('API_SECRET'));
  Logger.log(props.getProperty('ADMIN_PASSWORD')
    ? 'ADMIN_PASSWORD: 설정됨'
    : '★ ADMIN_PASSWORD 가 없습니다. [프로젝트 설정 > 스크립트 속성 > 속성 추가]에서 ADMIN_PASSWORD 를 추가하세요.');
}

/* ---------- 내부 유틸 ---------- */
function fail_(msg) { const e = new Error(msg); e.userMessage = msg; throw e; }

function times_() {
  const toMin = s => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
  const out = [];
  for (let t = toMin(CONFIG.START); t + CONFIG.INTERVAL_MIN <= toMin(CONFIG.END); t += CONFIG.INTERVAL_MIN) {
    out.push(String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0'));
  }
  return out;
}

// 예약 가능한 모든 칸(정원 있는 칸 + 추가 칸), 정렬 순서 겸용
function slots_() {
  return CONFIG.EXTRA_SLOT ? times_().concat(CONFIG.EXTRA_SLOT.key) : times_();
}
const isUnlimited_ = time => !!(CONFIG.EXTRA_SLOT && CONFIG.EXTRA_SLOT.unlimited && time === CONFIG.EXTRA_SLOT.key);

function dow_(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return DOW[new Date(y, m - 1, d).getDay()];
}

function fmt_(date, time) {
  const [, m, d] = date.split('-').map(Number);
  return `${m}월 ${d}일(${dow_(date)}) ${time}`;
}

const pad2_ = n => String(n).padStart(2, '0');
// 담당자가 직접 입력해 '2026. 11. 23' 같은 날짜 서식이 되어도 yyyy-MM-dd 로 맞춘다
function normDate_(s) {
  const m = String(s).match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
  return m ? `${m[1]}-${pad2_(m[2])}-${pad2_(m[3])}` : String(s).trim();
}
// '13:20', '13:20:00', '오후 1:20:00' → '13:20'. '17:00이후', '17:00 이후 가능' → EXTRA_SLOT.key
function normTime_(s) {
  const ex = CONFIG.EXTRA_SLOT, flat = String(s).replace(/\s/g, '');
  if (ex && (flat === ex.key.replace(/\s/g, '') || flat === ex.label.replace(/\s/g, ''))) return ex.key;
  const m = String(s).match(/(\d{1,2}):(\d{2})/);
  if (!m) return String(s).trim();
  let h = Number(m[1]);
  if (/오후|PM/i.test(s) && h < 12) h += 12;
  if (/오전|AM/i.test(s) && h === 12) h = 0;
  return pad2_(h) + ':' + m[2];
}

function headerRow_(sh) {
  return sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getDisplayValues()[0].map(s => String(s).trim());
}

// 시트가 없으면 만들고, 빠진 헤더가 있으면 오른쪽 끝에 추가한다
function sheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(CONFIG.SHEET) || ss.insertSheet(CONFIG.SHEET, 0);
  const head = headerRow_(sh);
  const missing = HEADER.filter(h => head.indexOf(h) < 0);
  if (missing.length) {
    const start = head.every(h => !h) ? 1 : head.length + 1;
    sh.getRange(1, start, 1, missing.length).setValues([missing]).setFontWeight('bold').setBackground('#e8f0fe');
    sh.setFrozenRows(1);
  }
  return sh;
}

// 예약 행을 { row(시트 행 번호), ts, date, dow, time, name, sid, major, phone } 로 읽는다. 빈 행은 무시.
function rows_(sh) {
  const last = sh.getLastRow();
  if (last < 2) return [];
  const vals = sh.getRange(1, 1, last, sh.getLastColumn()).getDisplayValues();
  const head = vals[0].map(s => String(s).trim());
  const idx = {};
  Object.keys(COL).forEach(k => { idx[k] = head.indexOf(COL[k]); });
  const out = [];
  for (let i = 1; i < vals.length; i++) {
    const o = { row: i + 1 };
    Object.keys(COL).forEach(k => { o[k] = idx[k] < 0 ? '' : String(vals[i][idx[k]]).trim(); });
    if (Object.keys(COL).every(k => !o[k])) continue;
    o.sid = digits_(o.sid);
    o.date = normDate_(o.date);
    o.time = normTime_(o.time);
    out.push(o);
  }
  return out;
}

function status_() {
  const now = new Date();
  if (CONFIG.OPEN_AT && now < new Date(CONFIG.OPEN_AT)) return 'before';
  if (CONFIG.CLOSE_AT && now > new Date(CONFIG.CLOSE_AT)) return 'closed';
  return 'open';
}

function countMap_(rows) {
  const c = {};
  rows.forEach(r => { const k = r.date + '|' + r.time; c[k] = (c[k] || 0) + 1; });
  return c;
}

const clean_ = s => String(s || '').trim().replace(/\s+/g, ' ');
const digits_ = s => String(s || '').replace(/\D/g, '');

function lock_() {
  const lock = LockService.getScriptLock();
  // Vercel 쪽 타임아웃(25초) 안에 끝나도록 15초만 기다린다
  if (!lock.tryLock(15000)) fail_('접속자가 많습니다. 잠시 후 다시 시도해주세요.');
  return lock;
}

/* ---------- API 액션 ---------- */
function getState() {
  return {
    title: CONFIG.TITLE,
    dates: CONFIG.DATES.map(d => ({ date: d, dow: dow_(d) })),
    times: times_(),
    capacity: CONFIG.CAPACITY,
    extraSlot: CONFIG.EXTRA_SLOT || null,   // 프론트가 각 날짜 마지막에 그린다
    counts: countMap_(rows_(sheet_())),   // 인원 수만. 이름 등 개인정보는 절대 내보내지 않음
    status: status_(),
    openAt: CONFIG.OPEN_AT,
    closeAt: CONFIG.CLOSE_AT
  };
}

function reserve(form) {
  const name = clean_(form.name);
  const sid = digits_(form.studentId);
  const major = clean_(form.major);
  const phoneDigits = digits_(form.phone);
  const date = String(form.date || '');
  const time = String(form.time || '');

  if (!name || !sid || !major || !phoneDigits) fail_('모든 항목을 입력해주세요.');
  if (name.length > 30 || major.length > 40) fail_('입력값이 너무 깁니다.');
  if (!/^\d{6,10}$/.test(sid)) fail_('학번을 정확히 입력해주세요.');
  if (!/^01\d{8,9}$/.test(phoneDigits)) fail_('연락처를 정확히 입력해주세요. (예: 010-1234-5678)');
  if (CONFIG.DATES.indexOf(date) < 0 || slots_().indexOf(time) < 0) fail_('잘못된 시간대입니다.');

  const st = status_();
  if (st === 'before') fail_('아직 예약 시작 전입니다.');
  if (st === 'closed') fail_('예약이 마감되었습니다.');

  const phone = phoneDigits.replace(/^(\d{3})(\d{3,4})(\d{4})$/, '$1-$2-$3');

  // 동시 접속 시 초과 예약 방지: 읽기~쓰기를 반드시 락 안에서 한 번에 한 명씩 처리
  const lock = lock_();
  try {
    const sh = sheet_();
    const rows = rows_(sh);

    const dup = rows.find(r => r.sid === sid);
    if (dup) {
      fail_(`이미 예약된 학번입니다. (${fmt_(dup.date, dup.time)})\n변경하려면 '내 예약 확인 / 취소'에서 취소 후 다시 예약해주세요.`);
    }
    const cnt = rows.filter(r => r.date === date && r.time === time).length;
    if (!isUnlimited_(time) && cnt >= CONFIG.CAPACITY) fail_('방금 해당 시간이 마감되었습니다. 다른 시간을 선택해주세요.');

    const rec = {
      ts: Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm:ss'),
      date, dow: dow_(date), time, name, sid, major, phone
    };
    const keyOf = {};
    Object.keys(COL).forEach(k => { keyOf[COL[k]] = k; });
    const head = headerRow_(sh);
    const range = sh.getRange(sh.getLastRow() + 1, 1, 1, head.length);
    range.setNumberFormat('@'); // 학번 앞자리 0, 날짜 자동변환 방지
    range.setValues([head.map(h => keyOf[h] ? rec[keyOf[h]] : '')]);
    SpreadsheetApp.flush();

    return { label: fmt_(date, time), name };
  } finally {
    lock.releaseLock();
  }
}

function lookup(studentId, phone) {
  const sid = digits_(studentId), p = digits_(phone);
  if (!sid || !p) fail_('학번과 연락처를 입력해주세요.');
  const r = rows_(sheet_()).find(r => r.sid === sid && digits_(r.phone) === p);
  return r ? { name: r.name, label: fmt_(r.date, r.time) } : null;
}

function cancel(studentId, phone) {
  const sid = digits_(studentId), p = digits_(phone);
  if (!sid || !p) fail_('학번과 연락처를 입력해주세요.');
  if (status_() === 'closed') fail_('예약 기간이 끝나 취소할 수 없습니다. 담당자에게 문의해주세요.');
  const lock = lock_();
  try {
    const sh = sheet_();
    const r = rows_(sh).find(r => r.sid === sid && digits_(r.phone) === p);
    if (!r) fail_('일치하는 예약이 없습니다.');
    sh.deleteRow(r.row);
    SpreadsheetApp.flush();
    return { cancelled: true };
  } finally {
    lock.releaseLock();
  }
}

function adminData(pw) {
  const real = PropertiesService.getScriptProperties().getProperty('ADMIN_PASSWORD');
  if (!real) fail_('관리자 비밀번호가 설정되지 않았습니다. 스크립트 속성에 ADMIN_PASSWORD를 추가하세요.');
  // ponytail: 전역 실패 카운터(10분 10회). IP별 제한이 필요하면 Vercel에서 IP를 넘겨 키에 포함.
  const cache = CacheService.getScriptCache();
  const fails = Number(cache.get('admin_fail') || 0);
  if (fails >= 10) fail_('비밀번호 오류가 많습니다. 10분 후 다시 시도해주세요.');
  if (String(pw || '') !== real) {
    cache.put('admin_fail', String(fails + 1), 600);
    fail_('비밀번호가 올바르지 않습니다.');
  }
  const sorted = refreshSortedSheet();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  return {
    rows: sorted,
    total: sorted.length,
    capacityTotal: CONFIG.DATES.length * times_().length * CONFIG.CAPACITY,
    exportUrl: `https://docs.google.com/spreadsheets/d/${ss.getId()}/export?format=xlsx`,
    sheetUrl: ss.getUrl()
  };
}

/* 날짜 → 시간 → 예약순으로 정렬한 명단 시트 생성 (엑셀 다운로드용) */
function refreshSortedSheet() {
  // 날짜 → 칸 순서(13:20 … 16:40, 17:00 이후, 그 외 값은 맨 뒤) → 예약일시
  const order = slots_();
  const pos = t => { const i = order.indexOf(t); return i < 0 ? order.length : i; };
  const rows = rows_(sheet_()).sort((a, b) =>
    a.date.localeCompare(b.date) || pos(a.time) - pos(b.time) || a.time.localeCompare(b.time) || a.ts.localeCompare(b.ts));
  const out = rows.map((r, i) => [i + 1, r.date, r.dow, r.time, r.name, r.sid, r.major, r.phone, r.ts]);

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(CONFIG.SORTED_SHEET) || ss.insertSheet(CONFIG.SORTED_SHEET);
  sh.clear();
  const head = ['순번', '면접날짜', '요일', '면접시간', '이름', '학번', '학과', '연락처', '예약일시'];
  sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold').setBackground('#e8f0fe');
  sh.setFrozenRows(1);
  if (out.length) {
    sh.getRange(2, 1, out.length, head.length).setNumberFormat('@').setValues(out.map(r => r.map(String)));
  }
  sh.autoResizeColumns(1, head.length);
  return out;
}
