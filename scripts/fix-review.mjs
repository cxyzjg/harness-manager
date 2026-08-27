import { readFileSync, writeFileSync } from "node:fs";
const p = "src/web/index.html";
let s = readFileSync(p, "utf-8");

const old1 = `async function showReview(id) {
  _view = "review"; // 进入审查回放, 停止列表轮询(避免被踢回)
  var r = await api("/api/session-review/" + encodeURIComponent(id));
  if (!r || r.error) return toast("无法加载会话审查");
  var m = r.metrics, oc = r.outcome;
  var turnsHtml = ((r.turns&&r.turns.list)||[]).map(function(t){`;

const new1 = `var _reviewData = null; // 当前审查数据(分批渲染)
var _reviewShown = 0;
function renderTurnBatch(list, from, to) {
  return list.slice(from, to).map(function(t){
    var think=(t.thinking||[]).map(function(th){return '<div style="color:#d8c48a;font-size:12px;margin:2px 0">💭 '+esc((th.text||"").replace(/\\s+/g," ").slice(0,140))+"…</div>";}).join("");
    var tools=(t.tools||[]).slice(0,6).map(function(tc){return '<div style="color:var(--accent);font-size:12px">🛠 '+esc(tc.name)+' <span class="muted">'+esc(tc.input||"")+"</span></div>";}).join("")+((t.tools.length>6)?'<div class="muted" style="font-size:11px">…共'+t.tools.length+"个</div>":"");
    var out=(t.textOutput&&t.textOutput[0])?'<div class="muted" style="font-size:12px;margin:3px 0">↩ '+esc(String(t.textOutput[0]).replace(/\\s+/g," ").slice(0,110))+"</div>":"";
    return '<div class="panel" style="margin:8px 0;padding:10px 14px;border-left:3px solid var(--line)">' +
      "<div><b>[turn "+t.index+"]</b> <span class=\\"muted\\">"+esc((t.ts||"").slice(11,19))+"</span> "+esc((t.userInput||"").slice(0,80))+
      ' <span class="tag" style="margin-left:8px">所见: '+t.contextAtTurn.messages+"msg/"+t.contextAtTurn.thinking+"💭/"+t.contextAtTurn.tools+"🛠</span></div>" +
      think+tools+out+"</div>";
  }).join("");
}
function loadMoreTurns() {
  var container = document.getElementById("turns-body");
  if (!container || !_reviewData) return;
  var total = _reviewData.turns ? _reviewData.turns.total : 0;
  var list = (_reviewData.turns && _reviewData.turns.list) || [];
  var next = _reviewShown + 25;
  container.insertAdjacentHTML("beforeend", renderTurnBatch(list, _reviewShown, next));
  _reviewShown = Math.min(next, total);
  var btn = document.getElementById("load-more-btn");
  if (btn) btn.remove();
  if (_reviewShown < total) {
    container.insertAdjacentHTML("beforeend", '<div id="load-more-btn" style="text-align:center;margin:10px"><button class="op" onclick="loadMoreTurns()">显示更多 turn (' + _reviewShown + "/" + total + ")</button></div>");
  }
}
async function showReview(id) {
  _view = "review"; // 进入审查回放, 停止列表轮询(避免被踢回)
  toast("加载审查回放…");
  var r = await api("/api/session-review/" + encodeURIComponent(id));
  if (!r || r.error) return toast("无法加载会话审查");
  _reviewData = r; _reviewShown = 0;
  var m = r.metrics, oc = r.outcome;`;

if (!s.includes(old1)) { console.error("showReview head not found"); process.exit(1); }
s = s.replace(old1, new1);

// 移除旧的整段 map 渲染(turnsHtml 定义), 换成首屏批量
const old2 = `  var turnsHtml = ((r.turns&&r.turns.list)||[]).map(function(t){
    var think=(t.thinking||[]).map(function(th){return '<div style="color:#d8c48a;font-size:12px;margin:2px 0">💭 '+esc((th.text||"").replace(/\\s+/g," ").slice(0,140))+"…</div>";}).join("");
    var tools=(t.tools||[]).slice(0,6).map(function(tc){return '<div style="color:var(--accent);font-size:12px">🛠 '+esc(tc.name)+' <span class="muted">'+esc(tc.input||"")+"</span></div>";}).join("")+((t.tools.length>6)?'<div class="muted" style="font-size:11px">…共'+t.tools.length+"个</div>":"");
    var out=(t.textOutput&&t.textOutput[0])?'<div class="muted" style="font-size:12px;margin:3px 0">↩ '+esc(String(t.textOutput[0]).replace(/\\s+/g," ").slice(0,110))+"</div>":"";
    return '<div class="panel" style="margin:8px 0;padding:10px 14px;border-left:3px solid var(--line)">' +
      "<div><b>[turn "+t.index+"]</b> <span class=\\"muted\\">"+esc((t.ts||"").slice(11,19))+"</span> "+esc((t.userInput||"").slice(0,80))+
      ' <span class="tag" style="margin-left:8px">所见: '+t.contextAtTurn.messages+"msg/"+t.contextAtTurn.thinking+"💭/"+t.contextAtTurn.tools+"🛠</span></div>" +
      think+tools+out+"</div>";
  }).join("");
  $("#content").innerHTML =`;
const new2 = `  var list = (r.turns&&r.turns.list)||[];
  var first = renderTurnBatch(list, 0, Math.min(25, list.length));
  _reviewShown = Math.min(25, list.length);
  var moreBtn = (_reviewShown < list.length) ? '<div id="load-more-btn" style="text-align:center;margin:10px"><button class="op" onclick="loadMoreTurns()">显示更多 turn (' + _reviewShown + "/" + list.length + ")</button></div>" : "";
  $("#content").innerHTML =`;
if (!s.includes(old2)) { console.error("turnsHtml block not found"); process.exit(1); }
s = s.replace(old2, new2);

// 尾部 turnsHtml 引用换 first+moreBtn
const old3 = `'<div class="panel"><h2>审查回放 ('+(r.turns?r.turns.total:0)+" turns — 思考为什么/工具做什么/agent 当时所见)</h2></div>" +
    '<div style="max-height:70vh;overflow:auto">'+turnsHtml+"</div>";`;
const new3 = `'<div class="panel"><h2>审查回放 ('+(r.turns?r.turns.total:0)+" turns — 思考为什么/工具做什么/agent 当时所见)</h2></div>" +
    '<div id="turns-body" style="max-height:70vh;overflow:auto">'+first+moreBtn+"</div>";`;
if (!s.includes(old3)) { console.error("tail not found"); process.exit(1); }
s = s.replace(old3, new3);

writeFileSync(p, s);
console.log("审查回放: 分批渲染 OK");
