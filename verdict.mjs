// _r32_egress_verdict.mjs — Round32 CF 边缘出口三态判据（#36 不假绿 / #44 D10.2 自带负控）
// 设计：判据只判定读数内容，不依赖 mode 字段。bad=1 负控因端点错自然翻红。
// 顶层 CLI：无参数 = 跑 selftest 并设 exitCode；--judge <file> = 判 readout.txt 里的 normal 与 bad 两行。
// 被 read.mjs 独立进程 spawn，不 import，故顶层 CLI 不污染任何调用方。
import * as fs from 'node:fs';

const PREFIX = 'R32-EGRESS-READOUT ';
const NL = String.fromCharCode(10);

function isNonEmptyString(v) { return typeof v === 'string' && v.length > 0; }

// 判定单个端点读数：REACHABLE = 结构化鉴权拒绝（http 200 + 合法 JSON + 可识别 errcode）；
// NOT_REACHABLE = 连接黑洞/404/超时/json 失败；NOT_PROVEN = 字段缺失证据不足。
export function judgeEndpoint(e) {
  if (!e || typeof e !== 'object') return 'NOT_PROVEN';
  if (!('http' in e) || !('json' in e) || !('keys' in e) || !('errcode' in e)) return 'NOT_PROVEN';
  if (e.http !== 200) return 'NOT_REACHABLE';
  if (e.json !== true) return 'NOT_REACHABLE';
  const keys = Array.isArray(e.keys) ? e.keys : [];
  if (keys.indexOf('errcode') < 0) return 'NOT_PROVEN';
  const ec = String(e.errcode);
  if (ec.length === 0 || ec === 'none' || ec === 'undefined' || ec === 'null') return 'NOT_PROVEN';
  return 'REACHABLE';
}

function normalizeReadings(o) {
  if (!o || typeof o !== 'object') return null;
  if (Array.isArray(o.readings)) return o.readings;
  if (Array.isArray(o.endpoints)) return o.endpoints;
  if ('http' in o) return [o];
  return null;
}

function coloOf(o, readings) {
  if (isNonEmptyString(o.colo)) return o.colo;
  for (const e of readings) if (e && isNonEmptyString(e.colo)) return e.colo;
  return null;
}

// 判定整捆读数：colo 必须非空非 unknown（否则不算 CF 边缘归属证据）。
export function judgeBundle(o) {
  const readings = normalizeReadings(o);
  if (!readings || readings.length === 0) return { verdict: 'EGRESS_NOT_PROVEN', rc: 2 };
  const colo = coloOf(o, readings);
  if (!colo || colo === 'unknown') return { verdict: 'EGRESS_NOT_PROVEN', rc: 2 };
  let sawNotReachable = false;
  let sawNotProven = false;
  for (const e of readings) {
    const r = judgeEndpoint(e);
    if (r === 'NOT_REACHABLE') sawNotReachable = true;
    else if (r === 'NOT_PROVEN') sawNotProven = true;
  }
  if (sawNotReachable) return { verdict: 'EGRESS_NOT_REACHABLE', rc: 1 };
  if (sawNotProven) return { verdict: 'EGRESS_NOT_PROVEN', rc: 2 };
  return { verdict: 'EGRESS_REACHABLE', rc: 0 };
}

// 判定一行日志：抽 PREFIX 后的单行 JSON；坏前缀/坏 JSON = NOT_PROVEN。
export function judgeLine(line) {
  if (typeof line !== 'string') return { verdict: 'EGRESS_NOT_PROVEN', rc: 2 };
  const i = line.indexOf(PREFIX);
  if (i < 0) return { verdict: 'EGRESS_NOT_PROVEN', rc: 2 };
  const payload = line.slice(i + PREFIX.length).trim();
  if (payload.length === 0) return { verdict: 'EGRESS_NOT_PROVEN', rc: 2 };
  let o;
  try { o = JSON.parse(payload); } catch (err) { return { verdict: 'EGRESS_NOT_PROVEN', rc: 2 }; }
  return judgeBundle(o);
}

// 判定读数对：normal 必须 REACHABLE 且 bad 必须非 REACHABLE（负控翻红）才收窄成立。
export function judgePair(normalLine, badLine) {
  const jn = judgeLine(normalLine);
  const jb = judgeLine(badLine);
  if (jn.rc === 0 && jb.rc !== 0) return { verdict: 'EGRESS_REACHABLE', rc: 0, normal: jn, bad: jb };
  if (jn.rc === 1) return { verdict: 'EGRESS_NOT_REACHABLE', rc: 1, normal: jn, bad: jb };
  return { verdict: 'EGRESS_NOT_PROVEN', rc: 2, normal: jn, bad: jb };
}

function goodEndpoint(ep) {
  return { ep: ep, http: 200, json: true, keys: ['errcode', 'errmsg'], errcode: '-14', ret: 'none', ms: 120, colo: 'HKG' };
}
function goodBundle() {
  return { colo: 'HKG', readings: [goodEndpoint('get_bot_qrcode'), goodEndpoint('getupdates'), goodEndpoint('sendmessage')] };
}
function badBundle() {
  return { colo: 'HKG', readings: [ { ep: 'bad', http: 404, json: false, keys: [], errcode: 'none', ret: 'none', ms: 5, colo: 'HKG' } ] };
}
function goodLine() { return PREFIX + JSON.stringify(goodBundle()); }
function badLine() { return PREFIX + JSON.stringify(badBundle()); }

function mutate(fn) { const b = goodBundle(); fn(b); return b; }

export function runSelftest() {
  const cases = [];
  let teeth = 0;
  let allPass = true;
  function add(name, got, want, isTooth) {
    const pass = got.rc === want;
    cases.push(name + '=' + (pass ? 'PASS' : 'FAIL') + '(rc' + got.rc + ')');
    if (isTooth && got.rc !== 0) teeth++;
    if (!pass) allPass = false;
  }
  // 正控：三端点全结构化 + colo 有效 = 绿
  add('POS_good_bundle', judgeBundle(goodBundle()), 0, false);
  add('POS_good_line', judgeLine(goodLine()), 0, false);
  add('POS_pair', judgePair(goodLine(), badLine()), 0, false);
  // 负控 12 类：每类必翻红（rc != 0）
  add('NC1_http500', judgeBundle(mutate((b) => { b.readings[1].http = 500; })), 1, true);
  add('NC2_json_false', judgeBundle(mutate((b) => { b.readings[2].json = false; })), 1, true);
  add('NC3_keys_no_errcode', judgeBundle(mutate((b) => { b.readings[0].keys = ['errmsg']; })), 2, true);
  add('NC4_errcode_none', judgeBundle(mutate((b) => { b.readings[1].errcode = 'none'; })), 2, true);
  add('NC5_colo_missing', judgeBundle((() => { const b = goodBundle(); delete b.colo; for (const e of b.readings) delete e.colo; return b; })()), 2, true);
  add('NC6_colo_unknown', judgeBundle((() => { const b = goodBundle(); b.colo = 'unknown'; for (const e of b.readings) e.colo = 'unknown'; return b; })()), 2, true);
  add('NC7_empty_readings', judgeBundle({ colo: 'HKG', readings: [] }), 2, true);
  add('NC8_no_prefix', judgeLine('random text without prefix'), 2, true);
  add('NC9_bad_json', judgeLine(PREFIX + 'not-json-at-all'), 2, true);
  add('NC10_unknown_shape', judgeBundle({ foo: 1 }), 2, true);
  add('NC11_bad_line_not_green', judgeLine(badLine()), 1, true);
  add('NC12_pair_bad_not_flip', judgePair(goodLine(), goodLine()), 2, true);
  // 钝化检测：全绿读数与全红读数不能返回同一 rc
  const green = judgeBundle(goodBundle()).rc;
  const red = judgeBundle(badBundle()).rc;
  const blunt = green === red ? 1 : 0;
  cases.push('TEETH_blunt=' + (blunt === 0 ? 'PASS' : 'FAIL'));
  if (blunt !== 0) allPass = false;
  const verdict = (allPass && teeth >= 10 && blunt === 0) ? 'PASS' : 'FAIL';
  const lastLine = 'R32-EGRESS-VERDICT-SELFTEST cases=' + cases.length + ' teeth=' + teeth + ' blunt=' + blunt + ' verdict=' + verdict;
  return { cases: cases, teeth: teeth, blunt: blunt, verdict: verdict, lastLine: lastLine };
}

// 顶层 CLI（无条件执行，不用 isMain 守卫：Git Bash 路径大小写会让守卫假绿）
const argv = process.argv.slice(2);
if (argv[0] === '--judge' && argv[1]) {
  const text = fs.readFileSync(argv[1], 'utf8');
  const lines = text.split(NL).filter((l) => l.indexOf(PREFIX) >= 0);
  const r = judgePair(lines[0] || '', lines[1] || '');
  console.log('R32-EGRESS-PAIR verdict=' + r.verdict + ' rc=' + r.rc + ' normal=' + r.normal.rc + ' bad=' + r.bad.rc);
  process.exitCode = r.rc;
} else {
  const s = runSelftest();
  for (const c of s.cases) console.log('  ' + c);
  console.log(s.lastLine);
  process.exitCode = s.verdict === 'PASS' ? 0 : 1;
}