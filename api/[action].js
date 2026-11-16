// 브라우저 → /api/[action] → Apps Script(doPost) 프록시.
// 시트는 여기서 직접 쓰지 않는다. 예약/취소 동시성은 Apps Script LockService가 책임진다.
const ACTIONS = new Set(['getState', 'reserve', 'lookup', 'cancel', 'adminData']);
const MAX_BODY = 2000;      // bytes. 정상 요청은 수백 바이트
const TIMEOUT_MS = 25000;
const RETRY_MSG = '서버가 혼잡합니다. 잠시 후 다시 시도해주세요.';

function send(res, status, body, cache = 'no-store') {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', cache);
  res.end(JSON.stringify(body));
}

async function callGas(action, payload) {
  const body = { ...payload, action, secret: process.env.GAS_SECRET }; // 클라이언트가 action/secret을 덮어쓰지 못하게 마지막에 둔다
  if (process.env.MOCK === '1') {
    const { callMock } = await import('./_mock.js');
    return callMock(body);
  }
  if (!process.env.GAS_URL || !process.env.GAS_SECRET) throw new Error('GAS_URL / GAS_SECRET 환경변수 없음');
  // Apps Script는 POST에 302(script.googleusercontent.com)로 응답한다.
  // fetch가 리다이렉트를 따라가며 GET으로 바꿔 최종 JSON을 받는다.
  const r = await fetch(process.env.GAS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(body),
    redirect: 'follow',
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`GAS HTTP ${r.status}: ${text.slice(0, 200)}`);
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('GAS가 JSON이 아닌 응답(권한/배포 설정 확인): ' + text.slice(0, 200)); }
  if (typeof data.ok !== 'boolean') throw new Error('GAS 응답 형식 오류');
  return data;
}

export default async function handler(req, res) {
  const action = req.query.action;
  if (!ACTIONS.has(action)) return send(res, 404, { ok: false, error: '잘못된 요청입니다.' });

  // getState만 GET 허용: CDN(s-maxage)은 GET만 캐시한다. 나머지는 POST.
  const isCachedGet = req.method === 'GET' && action === 'getState';
  if (req.method !== 'POST' && !isCachedGet) return send(res, 405, { ok: false, error: '잘못된 요청입니다.' });

  let payload = {};
  if (req.method === 'POST') {
    try { payload = req.body ?? {}; } catch { return send(res, 400, { ok: false, error: '잘못된 요청입니다.' }); }
    if (typeof payload === 'string') { try { payload = JSON.parse(payload || '{}'); } catch { return send(res, 400, { ok: false, error: '잘못된 요청입니다.' }); } }
    if (typeof payload !== 'object' || Array.isArray(payload)) return send(res, 400, { ok: false, error: '잘못된 요청입니다.' });
    if (Buffer.byteLength(JSON.stringify(payload)) > MAX_BODY) return send(res, 413, { ok: false, error: '입력값이 너무 깁니다.' });
  }

  try {
    const data = await callGas(action, payload);
    send(res, 200, data, isCachedGet && data.ok ? 'public, s-maxage=3' : 'no-store');
  } catch (e) {
    console.error(`[${action}]`, e);
    const timeout = e.name === 'TimeoutError' || e.name === 'AbortError';
    const msg = timeout && (action === 'reserve' || action === 'cancel')
      ? "응답이 늦어지고 있습니다. 이미 처리되었을 수 있으니 '내 예약 확인'에서 확인한 뒤 다시 시도해주세요."
      : RETRY_MSG;
    send(res, timeout ? 504 : 502, { ok: false, error: msg });
  }
}
