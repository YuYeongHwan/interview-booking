// 동시성 테스트. 끝나면 만든 예약을 cancel로 정리한다. (테스트 학번은 9999로 시작)
//  A. 정원 있는 칸: 서로 다른 학번 10건 동시 → 정확히 (정원-기존인원)건만 성공
//  B. 추가 칸(17:00 이후 가능, 정원 없음): 서로 다른 학번 10건 동시 → 10건 모두 성공
//  C. 같은 학번: 5건 동시 → 1건만 성공, 이후 다른 칸 예약도 중복으로 거부
//
//   Vercel/로컬 API 경유:   BASE_URL=http://localhost:3000 node scripts/race-test.js
//   Apps Script 직접 호출:  GAS_URL=https://script.google.com/.../exec GAS_SECRET=... node scripts/race-test.js
//   A 시간대 지정(선택):    SLOT=2026-11-27|16:40
const N = 10;
const { GAS_URL, GAS_SECRET, BASE_URL = 'http://localhost:3000', SLOT } = process.env;

async function call(action, payload = {}) {
  try {
    const r = GAS_URL
      ? await fetch(GAS_URL, { method: 'POST', body: JSON.stringify({ ...payload, action, secret: GAS_SECRET }), redirect: 'follow' })
      : await fetch(`${BASE_URL}/api/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const text = await r.text();
    try { return JSON.parse(text); } catch { return { ok: false, error: `JSON 아님 (HTTP ${r.status}) ${text.slice(0, 200)}` }; }
  } catch (e) { return { ok: false, error: e.message }; }
}
const state = async () => { const r = await call('getState'); if (!r.ok) throw new Error('getState 실패: ' + r.error); return r.data; };
const person = n => ({ name: `테스트${n}`, studentId: `9999${String(n).padStart(4, '0')}`, major: '테스트학과', phone: `0109999${String(n).padStart(4, '0')}` });

const S = await state();
if (S.status !== 'open') { console.error(`예약 상태가 '${S.status}' 입니다. OPEN_AT/CLOSE_AT을 확인하세요.`); process.exit(1); }

const made = new Map();   // 정리할 예약: studentId → phone
const checks = [];
const check = (name, pass, detail) => { checks.push(pass); console.log(`${pass ? 'PASS ✅' : 'FAIL ❌'} ${name} — ${detail}`); };

async function burst(people, date, time) {
  const t0 = Date.now();
  const res = await Promise.all(people.map(p => call('reserve', { ...p, date, time })));
  res.forEach((r, i) => { if (r.ok) made.set(people[i].studentId, people[i].phone); });
  const fails = {};
  res.filter(r => !r.ok).forEach(r => { fails[r.error] = (fails[r.error] || 0) + 1; });
  const ok = res.filter(r => r.ok).length;
  console.log(`  ${people.length}건 동시 (${Date.now() - t0}ms): 성공 ${ok}`, Object.keys(fails).length ? fails : '');
  return ok;
}

try {
  // A. 정원 있는 칸 — 실제 지원자와 겹치지 않게 마지막 날 마지막 시간부터 거꾸로 빈 칸을 찾는다
  let date, time;
  if (SLOT) [date, time] = SLOT.split('|');
  else outer: for (const d of [...S.dates].reverse()) for (const t of [...S.times].reverse()) {
    if (!S.counts[d.date + '|' + t]) { date = d.date; time = t; break outer; }
  }
  if (!date) throw new Error('빈 시간대가 없습니다. SLOT=날짜|시간 으로 지정하세요.');
  const before = S.counts[date + '|' + time] || 0, expected = Math.max(0, S.capacity - before);
  console.log(`\n[A] 정원 칸 ${date} ${time} (기존 ${before}명, 정원 ${S.capacity})`);
  const okA = await burst(Array.from({ length: N }, (_, i) => person(i)), date, time);
  const afterA = (await state()).counts[date + '|' + time] || 0;
  check('A 정원 칸', okA === expected && afterA === before + expected, `성공 ${okA}/기대 ${expected}, 시트 ${afterA}명`);

  // B. 추가 칸 (정원 제한 없음)
  const x = S.extraSlot;
  if (!x || !x.unlimited) console.log('\n[B] 정원 없는 추가 칸이 설정되지 않아 건너뜀');
  else {
    const xd = S.dates[S.dates.length - 1].date, xb = S.counts[xd + '|' + x.key] || 0;
    console.log(`\n[B] 추가 칸 ${xd} ${x.key} (기존 ${xb}명, 정원 없음)`);
    const okB = await burst(Array.from({ length: N }, (_, i) => person(100 + i)), xd, x.key);
    const afterB = (await state()).counts[xd + '|' + x.key] || 0;
    check('B 정원 없는 칸', okB === N && afterB === xb + N, `성공 ${okB}/${N}, 시트 ${afterB}명`);
  }

  // C. 같은 학번 중복
  const dupSlot = x ? x.key : S.times[0], dd = S.dates[0].date;
  console.log(`\n[C] 같은 학번 5건 동시 (${dd} ${dupSlot})`);
  const p = person(200);
  const okC = await burst(Array.from({ length: 5 }, () => p), dd, dupSlot);
  const again = await call('reserve', { ...p, date: dd, time: S.times[0] });
  check('C 학번 중복', okC === 1 && !again.ok && /이미 예약된 학번/.test(again.error),
    `동시 성공 ${okC}/기대 1, 다른 칸 재예약: ${again.ok ? '성공(문제)' : again.error.split('\n')[0]}`);
} finally {
  const res = await Promise.all([...made].map(([studentId, phone]) => call('cancel', { studentId, phone })));
  const left = res.filter(r => !r.ok);
  console.log(`\n정리: ${res.length - left.length}/${res.length}건 취소`);
  if (left.length) console.error('  정리 실패:', left.map(r => r.error), '→ 시트에서 학번 9999로 시작하는 행을 직접 지우세요.');
}

const pass = checks.length > 0 && checks.every(Boolean);
console.log(pass ? '\n전체 PASS ✅' : '\n전체 FAIL ❌');
process.exit(pass ? 0 : 1);
