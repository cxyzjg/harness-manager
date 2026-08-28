import { readFileSync, writeFileSync } from "node:fs";
const p = "src/web/index.html";
let s = readFileSync(p, "utf-8");

// 1) loadSessionsPage 读 sort 状态并传参
const oldHead = `async function loadSessionsPage() {
  _view = "sessions";
  var pair = await Promise.all([api("/api/v2/sessions"), api("/api/v2/fleet")]);
  var list = pair[0] || [];
  var fleet = pair[1] || {};`;
if (!s.includes(oldHead)) { console.error("head not found"); process.exit(1); }
const newHead = `var _sessSort = "active"; // 会话列表排序: active/started/tokens
async function loadSessionsPage() {
  _view = "sessions";
  var pair = await Promise.all([api("/api/v2/sessions?sort=" + _sessSort), api("/api/v2/fleet")]);
  var list = pair[0] || [];
  var fleet = pair[1] || {};`;
s = s.replace(oldHead, newHead);

// 2) 表头加排序切换按钮条
const oldPanel = `'    '<div class="panel"><h2>会话列表 (点击进入审查回放)</h2>' +`;
if (!s.includes(oldPanel)) { console.error("panel line not found"); process.exit(1); }
const newPanel = `'    '<div class="panel"><h2>会话列表 (点击进入审查回放)</h2>' +
      '<div style="margin:6px 0;display:flex;gap:6px;align-items:center">' +
        '<span class="muted" style="font-size:12px">排序:</span>' +
        '<button class="op' + (_sessSort==="active"?" active-tab":"") + '" onclick="setSessSort(\\'active\\')">🟢 最后活跃</button>' +
        '<button class="op' + (_sessSort==="started"?" active-tab":"") + '" onclick="setSessSort(\\'started\\')">🕐 开始时间</button>' +
        '<button class="op' + (_sessSort==="tokens"?" active-tab":"") + '" onclick="setSessSort(\\'tokens\\')">💰 token消耗</button>' +
      '</div>' +`;
s = s.replace(oldPanel, newPanel);

// 3) setSessSort 函数(插在 loadSessionsPage 前)
const fnAnchor = "var _sessSort = \"active\";";
if (!s.includes(fnAnchor)) { console.error("sort var not found"); process.exit(1); }
s = s.replace(fnAnchor, fnAnchor + `
function setSessSort(mode) {
  _sessSort = mode;
  loadSessionsPage();
}`);
writeFileSync(p, s);
console.log("排序切换 OK");
