// MOCK=1 전용. 실제 apps-script/Code.gs 를 그대로 실행하고, 구글 서비스만 흉내 낸다(로직 중복 없음).
// 시트 데이터는 임시 파일에 저장(요청마다 프로세스가 달라도 유지), LockService는 mkdir 락으로 흉내.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';

const DB = process.env.MOCK_DB || path.join(os.tmpdir(), 'interview-booking-mock.json');
const LOCK = DB + '.lock';
const sleep = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const self = function () { return this; };

function spreadsheet() {
  let db = {};
  try { db = JSON.parse(fs.readFileSync(DB, 'utf8')); } catch {}
  const save = () => fs.writeFileSync(DB, JSON.stringify(db));
  const sheet = name => {
    const g = db[name];
    const range = (r, c, nr = 1, nc = 1) => ({
      getDisplayValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => String(g[r - 1 + i]?.[c - 1 + j] ?? ''))),
      setValues(v) {
        v.forEach((row, i) => row.forEach((x, j) => { const R = (g[r - 1 + i] ||= []); R[c - 1 + j] = String(x); }));
        save(); return this;
      },
      setNumberFormat: self, setFontWeight: self, setBackground: self
    });
    return {
      getRange: range,
      getLastRow: () => g.length,
      getLastColumn: () => Math.max(0, ...g.map(r => r.length)),
      deleteRow: n => { g.splice(n - 1, 1); save(); },
      clear: () => { g.length = 0; save(); },
      setFrozenRows() {}, autoResizeColumns() {}
    };
  };
  return {
    getSheetByName: n => (db[n] ? sheet(n) : null),
    insertSheet: n => { db[n] = []; save(); return sheet(n); },
    getId: () => 'MOCK', getUrl: () => '#mock-sheet'
  };
}

const globals = {
  console,
  SpreadsheetApp: { getActiveSpreadsheet: spreadsheet, flush() {} },
  LockService: {
    getScriptLock: () => ({
      tryLock(ms) {
        const end = Date.now() + ms;
        for (;;) {
          try { fs.mkdirSync(LOCK); return true; } catch {}
          try { if (Date.now() - fs.statSync(LOCK).mtimeMs > 30000) fs.rmSync(LOCK, { recursive: true, force: true }); } catch {}
          if (Date.now() > end) return false;
          sleep(10);
        }
      },
      releaseLock: () => fs.rmSync(LOCK, { recursive: true, force: true })
    })
  },
  PropertiesService: { getScriptProperties: () => ({ getProperty: k => ({ API_SECRET: 'mock', ADMIN_PASSWORD: 'admin' })[k] ?? null, setProperty() {} }) },
  CacheService: { getScriptCache: () => ({ get: () => null, put() {} }) },
  ContentService: { createTextOutput: s => ({ setMimeType: self, getContent: () => s }), MimeType: { JSON: 'json' } },
  Utilities: {
    formatDate: d => new Date(d.getTime() + 9 * 3600e3).toISOString().replace('T', ' ').slice(0, 19), // Asia/Seoul 고정
    getUuid: () => crypto.randomUUID()
  },
  Logger: { log: console.log }
};

const ctx = vm.createContext(globals);
vm.runInContext(fs.readFileSync(path.join(process.cwd(), 'apps-script/Code.gs'), 'utf8'), ctx);
// 테스트용 현재 시각 주입: MOCK_NOW=2026-11-20T13:00:01+09:00 → 마감 후 상태
if (process.env.MOCK_NOW) ctx.now_ = () => new Date(process.env.MOCK_NOW);

export function callMock(body) {
  const out = ctx.doPost({ postData: { contents: JSON.stringify({ ...body, secret: 'mock' }) } });
  return JSON.parse(out.getContent());
}
