# _r32_readout — Round32 GH 读通道（占位骨架，部署后再填 PROBE_URL）

拓扑（严格区分，防假绿）：
- GitHub Actions ubuntu-latest runner = 读通道，只 GET 诊断 Worker 并读回读数。
- 诊断 Worker dsh-ilink-egress-probe-r32 的 fetch handler 在 Cloudflare 边缘运行时发起到 iLink 的 POST = 被测出口。
- 本机既不是被测出口也不是读通道；本机只做判据复算与封印。

流程：workflow 先 node verdict.mjs 跑判据 selftest（自证有牙），再 node read.mjs 抓两行读数写 readout.txt，
再 node verdict.mjs --judge readout.txt 判 normal 与 bad 读数对，最后 cat 原样读数。

部署前：PROBE_URL 取 GitHub 仓 variable（gh variable set PROBE_URL -b <部署后 workers.dev URL>）。
占位符 = REPLACE_WITH_DEPLOYED_WORKER_URL，未填真实 URL 时 read.mjs 写空 bundle，判据恒 NOT_PROVEN，不假绿。

诚实边界：
- 不带 token、不产 token、不绑账号、不做真实收发、不证 PC-off。
- 结构化 errcode -14 = 端点可达 + 请求形状被识别 + 只差真 token，是网络层/协议形状层的必要条件证据，非充分条件。
- 带真 token 的鉴权层/业务层可达仍 UNKNOWN（须真人扫码）。
- 达标闸恒 ACCEPTANCE=NOT_PROVEN rc=2；r29 NO_INJECT 不翻案；合成证据 NOT a real PC-off。