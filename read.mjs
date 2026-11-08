// read.mjs — GH runner 读通道：只负责触发诊断 Worker 并读回读数，被测出口是 CF 边缘 colo 不是本机。
// 严格区分：runner = 读通道（GET），诊断 Worker 的 fetch handler = 被测出口（POST 到 iLink）。
import * as fs from 'node:fs';

const PREFIX = 'R32-EGRESS-READOUT ';
const NL = String.fromCharCode(10);
const url = process.env.PROBE_URL || '';
const out = [];

for (const q of ['', '?bad=1']) {
  let bundle = null;
  try {
    const r = await fetch(url + q);
    const t = await r.text();
    try {
      const j = JSON.parse(t);
      const rr = Array.isArray(j.readings) ? j.readings : (Array.isArray(j.endpoints) ? j.endpoints : null);
      if (rr) bundle = { colo: j.colo, readings: rr };
    } catch (e1) {
      // 响应体可能是纯文本前缀行，退而抓前缀
      const i = t.indexOf(PREFIX);
      if (i >= 0) {
        const rest = t.slice(i + PREFIX.length).split(NL)[0].trim();
        try { const j2 = JSON.parse(rest); bundle = { colo: j2.colo, readings: j2.readings || j2.endpoints }; } catch (e2) {}
      }
    }
  } catch (e0) {
    // 网络失败：写空 bundle，让判据判 NOT_PROVEN，诚实不假绿
  }
  if (!bundle) bundle = { colo: 'unknown', readings: [] };
  out.push(PREFIX + JSON.stringify(bundle));
}
fs.writeFileSync('readout.txt', out.join(NL) + NL);
console.log('R32-READ-OUT lines=' + out.length + ' url_set=' + (url.length > 0));