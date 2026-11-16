// 동시성 테스트: 같은 시간대에 서로 다른 학번 10건을 동시에 reserve → 정확히 (정원-기존인원)건만 성공해야 한다.
// 끝나면 만든 예약을 cancel로 정리한다.
//
//   Vercel/로컬 API 경유:   BASE_URL=http://localhost:3000 node scripts/race-test.js
//   Apps Script 직접 호출:  GAS_URL=https://script.google.com/.../exec GAS_SECRET=... node scripts/race-test.js
//   시간대 지정(선택):      SLOT=2026-11-27|16:40
const N = 10;
const { GAS_URL, GAS_SECRET, BASE_URL = 'http://localhost:3000', SLOT } = process.env;

async function call(action, payload = {}) {
  const r = GAS_URL
    ? await fetch(GAS_URL, { method: 'POST', body: JSON.stringify({ ...payload, action, secret: GAS_SECRET }), redirect: 'follow' })
    : await fetch(`${BASE_URL}/api/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const text = await r.text();
  try { return JSON.parse(text); } catch { throw new Error(`${action}: JSON 아님 (HTTP ${r.status}) ${text.slice(0, 200)}`); }
}

const st = await call('getState');
if (!st.ok) throw new Error('getState 실패: ' + st.error);
const S = st.data;
if (S.status !== 'open') { console.error(`예약 상태가 '${S.status}' 입니다. OPEN_AT/CLOSE_AT을 확인하세요.`); process.exit(1); }

let date, time;
if (SLOT) [date, time] = SLOT.split('|');
else {
  // 실제 지원자와 겹치지 않도록 마지막 날 마지막 시간부터 거꾸로 빈 시간대를 찾는다
  outer: for (const d of [...S.dates].reverse()) for (const t of [...S.times].reverse()) {
    if (!S.counts[d.date + '|' + t]) { date = d.date; time = t; break outer; }
  }
}
if (!date) { console.error('빈 시간대가 없습니다. SLOT=날짜|시간 으로 지정하세요.'); process.exit(1); }
const before = S.counts[date + '|' + time] || 0;
const expected = Math.max(0, S.capacity - before);
console.log(`대상: ${date} ${time} (기존 ${before}명, 정원 ${S.capacity}) → 기대 성공 ${expected}건`);

const people = Array.from({ length: N }, (_, i) => ({
  name: `테스트${i}`, studentId: `9999${String(i).padStart(4, '0')}`, major: '테스트학과', phone: `0109999${String(i).padStart(4, '0')}`
}));

const t0 = Date.now();
const results = await Promise.all(people.map(p => call('reserve', { ...p, date, time }).catch(e => ({ ok: false, error: e.message }))));
console.log(`동시 ${N}건 완료 (${Date.now() - t0}ms)`);
results.forEach((r, i) => console.log(`  ${people[i].studentId}: ${r.ok ? '성공' : '실패 - ' + r.error}`));

const after = (await call('getState')).data.counts[date + '|' + time] || 0;
const success = results.filter(r => r.ok).length;

// 정리: 성공한 예약만 취소 (테스트 학번 9999xxxx)
const okPeople = people.filter((_, i) => results[i].ok);
const cleaned = await Promise.all(okPeople.map(p => call('cancel', { studentId: p.studentId, phone: p.phone })));
const left = cleaned.filter(r => !r.ok);
console.log(`정리: ${okPeople.length - left.length}/${okPeople.length}건 취소`);
if (left.length) console.error('  정리 실패:', left.map(r => r.error), '→ 시트에서 학번 9999로 시작하는 행을 직접 지우세요.');

const pass = success === expected && after === before + expected;
console.log(`\n성공 ${success}건 / 기대 ${expected}건, 시트 인원 ${after}명 (정원 ${S.capacity}) → ${pass ? 'PASS ✅' : 'FAIL ❌'}`);
process.exit(pass ? 0 : 1);
