import { readFileSync, writeFileSync } from "node:fs";
const p = "src/web/index.html";
let s = readFileSync(p, "utf-8");

// ========== 1. 会话历史防闪: 数据指纹对比 ==========
const oldHead = `var _sessSort = "active"; // active/started/tokens
async function loadSessionsPage() {
  _view = "sessions";
  var pair = await Promise.all([api("/api/v2/sessions?sort=" + _sessSort), api("/api/v2/fleet")]);
  var list = pair[0] || [];
  var fleet = pair[1] || {};`;
if (!s.includes(oldHead)) { console.error("P5-1 head not found"); process.exit(1); }
const newHead = `var _sessSort = "active"; // active/started/tokens
var _sessFingerprint = ""; // 数据指纹, 无变化不重渲染(防轮询闪烁)
var _sessView = "flat"; // flat=平铺列表 / group=按项目分组
async function loadSessionsPage() {
  _view = "sessions";
  var pair = await Promise.all([api("/api/v2/sessions?sort=" + _sessSort), api("/api/v2/fleet")]);
  var list = pair[0] || [];
  var fleet = pair[1] || {};
  // 指纹: 数量+最新ended_at+排序方式, 相同则跳过重渲染
  var fp = _sessSort + "|" + list.length + "|" + ((list[0] && list[0].ended_at) || "") + "|" + (fleet.globalGrade || "");
  if (fp === _sessFingerprint && document.getElementById("sess-table")) {
    document.querySelectorAll(".sort-btn").forEach(function(x){ x.classList.toggle("active-tab", x.dataset.sort === _sessSort); });
    document.querySelectorAll(".view-btn").forEach(function(x){ x.classList.toggle("active-tab", x.dataset.view === _sessView); });
    return;
  }
  _sessFingerprint = fp;`;
s = s.replace(oldHead, newHead);

// ========== 2. 会话历史加平铺/分组切换 + 表格容器固定id ==========
const oldPanel = `  var sb = document.querySelectorAll(".sort-btn");
    sb.forEach(function(x){ x.classList.toggle("active-tab", x.dataset.sort === _sessSort); });
    $("#content").innerHTML =
    '<div class="panel"><h2>会话历史 (统一库: '+list.length+' 会话 · 全局等级 <span class="tag yellow">'+(fleet.globalGrade||"-")+'</span> · 错误率 '+(fleet.errorRate*100).toFixed(1)+'% · 每2分钟自动同步)</h2>' +
      '<div style="margin:6px 0;display:flex;gap:6px;align-items:center">' +
        '<span class="muted" style="font-size:12px">排序:</span>' +
        '<button class="op sort-btn" data-sort="active">🟢 最后活跃</button>' +
        '<button class="op sort-btn" data-sort="started">🕐 开始时间</button>' +
        '<button class="op sort-btn" data-sort="tokens">💰 token消耗</button>' +
      '</div>' +
      '<table><thead><tr><th>id</th><th>harness</th><th>日期</th><th>turn/工具/思考</th><th>token</th><th>模型</th><th>项目</th></tr></thead><tbody>'+(rows || '<tr><td colspan="7" class="muted">暂无。点击右上"🔄刷新数据"</td></tr>')+'</tbody></table></div>';
}`;
if (!s.includes(oldPanel)) { console.error("P5-2 panel not found"); process.exit(1); }
const newPanel = `  var sb = document.querySelectorAll(".sort-btn");
    sb.forEach(function(x){ x.classList.toggle("active-tab", x.dataset.sort === _sessSort); });
    var viewBtns =
      '<span class="muted" style="font-size:12px;margin-left:8px">视图:</span>' +
      '<button class="op view-btn' + (_sessView==="flat"?" active-tab":"") + '" data-view="flat">列表</button>' +
      '<button class="op view-btn' + (_sessView==="group"?" active-tab":"") + '" data-view="group">📁 按项目</button>';
    var tableHtml;
    if (_sessView === "group") {
      // 按项目分组: 折叠显示每个项目下的会话
      var byProject = {};
      list.forEach(function(s){
        var key = (s.cwd || "(unknown)").replace(/[\\\\/]+$/, "");
        (byProject[key] = byProject[key] || []).push(s);
      });
      var keys = Object.keys(byProject).sort(function(a,b){
        var ma = Math.max.apply(null, byProject[a].map(function(x){return new Date(x.ended_at||x.started_at||0).getTime();}));
        var mb = Math.max.apply(null, byProject[b].map(function(x){return new Date(x.ended_at||x.started_at||0).getTime();}));
        return mb - ma;
      });
      tableHtml = keys.map(function(k){
        var sess = byProject[k];
        var gid = "pg-" + esc(k).replace(/[^a-zA-Z0-9]/g, "_");
        var totTok = sess.reduce(function(a,s){ return a + (s.stats? (s.stats.tokensIn||0)+(s.stats.tokensOut||0) : 0); }, 0);
        return '<div class="panel" style="padding:8px 12px;margin-bottom:8px">' +
          '<div style="cursor:pointer" onclick="var b=document.getElementById(\\''+gid+'\\');b.style.display=b.style.display===\\'none\\'?\\'block\\':\\'none\\'">' +
          '<b>📁 ' + esc(k) + '</b> <span class="muted" style="font-size:12px">' + sess.length + ' 会话 · ' + fmt(totTok) + ' token</span></div>' +
          '<div id="' + gid + '" style="display:none;margin-top:6px">' +
          sess.map(function(s){ var st=s.stats||{}; return '<div style="font-size:12px;margin:3px 0 3px 12px">' +
            '<a href="#" onclick="showReview(\\''+esc(s.id)+'\\');return false;" class="mono">' + esc(s.id.slice(s.id.indexOf(":")+1)) + '</a>' +
            ' <span class="muted">' + esc((s.started_at||"").slice(0,10)) + ' · ' + (st.turns||0) + 't/' + (st.tools||0) + '🛠 · ' + fmt((st.tokensIn||0)+(st.tokensOut||0)) + ' tok</span></div>'; }).join("") +
          '</div></div>';
      }).join("");
    } else {
      tableHtml = '<table><thead><tr><th>id</th><th>harness</th><th>日期</th><th>turn/工具/思考</th><th>token</th><th>模型</th><th>项目</th></tr></thead><tbody>' + (rows || '<tr><td colspan="7" class="muted">暂无。点击右上"🔄刷新数据"</td></tr>') + '</tbody></table>';
    }
    $("#content").innerHTML =
    '<div class="panel"><h2>会话历史 (统一库: '+list.length+' 会话 · 全局等级 <span class="tag yellow">'+(fleet.globalGrade||"-")+'</span> · 错误率 '+(fleet.errorRate*100).toFixed(1)+'%)</h2>' +
      '<div style="margin:6px 0;display:flex;gap:6px;align-items:center">' +
        '<span class="muted" style="font-size:12px">排序:</span>' +
        '<button class="op sort-btn" data-sort="active">🟢 最后活跃</button>' +
        '<button class="op sort-btn" data-sort="started">🕐 开始时间</button>' +
        '<button class="op sort-btn" data-sort="tokens">💰 token消耗</button>' +
        viewBtns +
      '</div>' +
      tableHtml + '</div>';
  // 渲染后恢复视图按钮高亮
  document.querySelectorAll(".view-btn").forEach(function(x){ x.classList.toggle("active-tab", x.dataset.view === _sessView); });
}`;
s = s.replace(oldPanel, newPanel);

// 3) 轮询间隔 5s -> 15s(减少闪烁概率; 后端已有60s自动扫描)
s = s.replace('sessTimer = setTimeout(function(){ if(_view==="sessions" && document.querySelector(\'nav button.active\')?.dataset.page==="sessions") loadSessionsPage(); },5000);',
              'sessTimer = setTimeout(function(){ if(_view==="sessions" && _sessView==="flat" && document.querySelector(\'nav button.active\')?.dataset.page==="sessions") loadSessionsPage(); },15000);');

// ========== 4. tab 切换保留滚动位置 ==========
const oldRv = `function rvTab(tab) {
  var v = window._rv;
  if (!v) return;`;
if (!s.includes(oldRv)) { console.error("rvTab not found"); process.exit(1); }
const newRv = `window._rvScroll = {}; // 各tab滚动位置
function rvTab(tab) {
  var v = window._rv;
  if (!v) return;
  // 保存当前tab滚动位置
  var curBody = document.getElementById("rv-body");
  if (curBody && window._rvCurTab) window._rvScroll[window._rvCurTab] = curBody.scrollTop;
  window._rvCurTab = tab;`;
s = s.replace(oldRv, newRv);

// 每个 tab 渲染后恢复滚动位置: 在 rvTab 的分发后统一处理
const oldDispatch = `  if (tab === "overview") return rvOverview(v);
  if (tab === "replay") return rvReplay(v);
  if (tab === "context") return rvContext(v);
  if (tab === "config") return rvConfig(v);`;
if (!s.includes(oldDispatch)) { console.error("dispatch not found"); process.exit(1); }
const newDispatch = `  if (tab === "overview") rvOverview(v);
  else if (tab === "replay") rvReplay(v);
  else if (tab === "context") rvContext(v);
  else if (tab === "config") rvConfig(v);
  // 恢复滚动位置
  requestAnimationFrame(function(){
    var body = document.getElementById("rv-body");
    if (body) body.scrollTop = window._rvScroll[tab] || 0;
  });`;
s = s.replace(oldDispatch, newDispatch);

// rv-body 需要可滚动(否则无scrollTop): 概览/配置也套滚动容器 —— 在各tab渲染的容器上已有 max-height 的只有 replay/context; 给 rv-body 统一 overflow
s = s.replace("'<div id=\"rv-body\"></div>';", "'<div id=\"rv-body\" style=\"max-height:75vh;overflow-y:auto\"></div>';");

writeFileSync(p, s);
console.log("P5 体验优化 OK");
