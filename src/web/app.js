const $ = (sel) => document.querySelector(sel);
const _token = window.localStorage.getItem("hm-token") || "";
const api = async (p) => {
  var res = await fetch(p, { headers: _token ? { "Authorization": "Bearer " + _token } : {} });
  if (res.status === 401) {
    var t = prompt("本机已启用访问鉴权, 请输入 authToken (config.json 的 authToken 字段):");
    if (t != null) { window.localStorage.setItem("hm-token", t); return api(p); }
    throw new Error("401 unauthorized");
  }
  return res.json();
};
const toast = (msg) => {
  let el = document.getElementById("toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "toast";
    el.style.cssText = "position:fixed;bottom:24px;right:24px;background:#2d333b;border:1px solid var(--line);color:var(--fg);padding:12px 18px;border-radius:10px;z-index:999;box-shadow:0 4px 16px rgba(0,0,0,.4);max-width:400px;font-size:13px";
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.style.display = "block";
  clearTimeout(el._t);
  el._t = setTimeout(() => (el.style.display = "none"), 5000);
};
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
const fmt = (n) => (n ?? 0).toLocaleString();
const tag = (t) => `<span class="tag ${t}">${t}</span>`;
const statusTag = (s, migratedTo) => {
  const map = {
    active: ["green", "active"],
    candidate: ["yellow", "候选"],
    "duplicate-of": ["red", "重复"],
    "superseded-by": ["red", "被取代"],
    migrated: ["green", `已迁→${esc(migratedTo || "单源")}`],
  };
  const [c, label] = map[s] || ["", s];
  return `<span class="tag ${c}">${esc(label)}</span>`;
};

function showTree(id) {
  document.getElementById("tab-story").classList.remove("active-tab");
  document.getElementById("tab-tree").classList.add("active-tab");
  document.getElementById("session-view").innerHTML = `<div class="trace">${esc(cachedSessionTree[id] || "（无调用）")}</div>`;
}

const cachedSessionTree = {};

var _view2 = ""; // live 页轮询视图
var livePaused = false;
var liveLines = [];
const pages = { dash: loadDash, skills: loadSkills, sessions: loadSessionsPage, live: loadLivePage };

async function showReliability() {
  _view = "reliability";
  var d = await api("/api/v2/reliability");
  if (!d) return toast("无数据");
  // 错误下钻
  var errRows = (d.errors||[]).map(function(e){
    return "<tr><td>"+esc(e.name)+"</td><td class='muted'>"+esc(typeof e.input==="string"?e.input.slice(0,60):JSON.stringify(e.input||"").slice(0,60))+"</td><td class='muted'>"+esc((e.started_at||"").slice(0,16))+"</td>" +
      '<td><button class="op" onclick="showReview(\''+esc(e.session_id)+'\')">查看会话 turn'+(e.turn_idx>=0?e.turn_idx:"")+'</button></td></tr>';
  }).join("");
  var retryRows = (d.retries||[]).map(function(e){
    return "<tr><td>"+esc(e.name)+"</td><td class='muted'>"+esc((e.started_at||"").slice(0,16))+"</td>" +
      '<td><button class="op" onclick="showReview(\''+esc(e.session_id)+'\')">查看会话</button></td></tr>';
  }).join("");
  var sessRows = (d.sessions||[]).slice().sort(function(a,b){ return b.errors-a.errors || b.tools-a.tools; }).map(function(m){
    var g = m.grade;
    var tag = '<span class="tag '+(g==="A"?"green":g==="B"?"yellow":"red")+'">'+g+"</span>";
    return "<tr><td>"+tag+"</td>" +
      '<td><a href="#" onclick="showReview(\''+esc(m.sessionId)+'\');return false;" class="mono">'+esc(m.sessionId.slice(m.sessionId.indexOf(":")+1, m.sessionId.indexOf(":")+19))+"</a></td>" +
      "<td>"+esc(m.harness)+"</td><td>"+m.turns+"t/"+m.tools+"🛠</td>" +
      "<td>"+m.errors+(m.errors?' <span class="tag red">'+(m.errorRate*100).toFixed(1)+"%</span>":"")+"</td>" +
      "<td>"+m.retries+" ("+(m.retryRate*100).toFixed(1)+"%)</td>" +
      "<td>"+m.emptyTurns+"</td>" +
      '<td class="muted">'+esc((m.cwd||"").slice(-28))+"</td></tr>";
  }).join("");
  $("#content").innerHTML =
    '<button onclick="loadDash()" style="background:none;border:none;color:var(--accent);cursor:pointer;margin-bottom:10px">← 返回仪表盘</button>' +
    '<div class="panel"><h2>🔴 错误调用下钻 ('+(d.errors||[]).length+') — 哪个工具/什么错/哪个turn, 点进去看现场</h2>' +
      '<table><thead><tr><th>工具</th><th>入参/输出摘录</th><th>时间</th><th></th></tr></thead><tbody>'+(errRows || '<tr><td colspan="4" class="muted">无错误调用 ✓</td></tr>')+'</tbody></table></div>' +
    '<div class="panel"><h2>🔁 重试模式 ('+(d.retries||[]).length+') — 相邻同名同参调用</h2>' +
      '<table><thead><tr><th>工具</th><th>时间</th><th></th></tr></thead><tbody>'+(retryRows || '<tr><td colspan="3" class="muted">无重试模式 ✓</td></tr>')+'</tbody></table></div>' +
    '<div class="panel"><h2>📋 会话可靠性明细 (按错误数排序, 点击进入审查回放)</h2>' +
      '<table><thead><tr><th>等级</th><th>id</th><th>harness</th><th>规模</th><th>错误</th><th>重试</th><th>空转</th><th>项目</th></tr></thead><tbody>'+sessRows+"</tbody></table></div>";
}

async function loadLivePage() {
  _view2 = "live";
  var liveIcon = livePaused ? "▶ 继续" : "⏸ 暂停";
  $("#content").innerHTML =
    '<div class="panel" style="padding:10px 14px">' +
      '<div class="term-titlebar">' +
        '<span class="term-dot" style="background:#f85149"></span><span class="term-dot" style="background:#d29922"></span><span class="term-dot" style="background:#3fb950"></span>' +
        '<span style="color:var(--muted);font-size:12px;margin-left:6px">harness-manager — agent 实时观测</span>' +
        '<button class="op" id="live-toggle" onclick="toggleLivePause()" style="margin-left:auto">' + liveIcon + "</button>" +
        '<button class="op" onclick="document.getElementById(\'term-body\').innerHTML=\'\';liveLines=[]">清屏</button>' +
        '<span class="muted" style="font-size:11px">skills 触发也会显示 · 每2s刷新' + (livePaused ? " · 已暂停" : "") + "</span>" +
      "</div>" +
      '<div class="term" id="term-body"><div class="term-line term-sys">[harness-manager] 等待 agent 事件… <span class="term-cursor"></span></div></div>' +
    "</div>";
  pollLive();
}

function toggleLivePause() {
  livePaused = !livePaused;
  document.getElementById("live-toggle").textContent = livePaused ? "▶ 继续" : "⏸ 暂停";
}

async function pollLive() {
  if (_view2 !== "live") return;
  if (!livePaused) {
    try {
      var snap = await api("/api/live");
      var body = document.getElementById("term-body");
      if (body && snap && snap.recent) {
        // 只追加新事件(按 ts+type 去重)
        var seenKey = function(e){ return e.ts + "|" + e.type + "|" + (e.toolName||"") + "|" + ((e.thinking||e.text||e.prompt||"")).length; };
        if (!window._liveSeen) window._liveSeen = new Set();
        var fresh = snap.recent.slice().reverse().filter(function(e){ return !window._liveSeen.has(seenKey(e)); });
        for (var i = 0; i < fresh.length; i++) {
          var e = fresh[i]; window._liveSeen.add(seenKey(e));
          var t = (e.ts || "").slice(11, 19);
          var line = "";
          if (e.type === "session_start") line = '<span class="term-ts">[' + t + "]</span> <span class='term-sys'>▶ 会话开始</span> " + esc(e.cwd || "");
          else if (e.type === "session_shutdown") line = '<span class="term-ts">[' + t + "]</span> <span class='term-sys'>■ 会话结束</span>";
          else if (e.type === "skill_trigger") line = '<span class="term-ts">[' + t + "]</span> <span class='term-sys'>⚡ 技能触发:</span> " + esc((e.skills||[]).join(", ")) + ' <span class="muted">@ ' + esc((e.cwd||"").slice(-30)) + "</span>";
          else if (e.type === "compaction") line = '<span class="term-ts">[' + t + "]</span> <span class='term-warn'>🗜 上下文压缩</span> (" + esc(e.reason||"auto") + ")";
          else if (e.type === "model_change") line = '<span class="term-ts">[' + t + "]</span> <span class='term-sys'>⚙ 模型切换</span> " + esc(e.model || "");
          else if (e.type === "tool_call") line = '<span class="term-ts">[' + t + "]</span> <span class='term-tool'>$ " + esc(e.toolName) + "</span> " + esc(JSON.stringify(e.input || "").slice(0, 110));
          else if (e.type === "assistant_message") {
            var th = (e.thinking || "").replace(/\s+/g, " ").trim();
            if (th) line = '<span class="term-ts">[' + t + "]</span> <span class='term-think'>💭 " + esc(th.slice(0, 160)) + "</span>";
            var tx = (e.text || "").replace(/\s+/g, " ").trim();
            if (tx) body.insertAdjacentHTML("beforeend", '<div class="term-line"><span class="term-ts">[' + t + "]</span> 🗣 " + esc(tx.slice(0, 160)) + "</div>");
          }
          if (line) body.insertAdjacentHTML("beforeend", '<div class="term-line">' + line + "</div>");
        }
        if (fresh.length) body.scrollTop = body.scrollHeight;
      }
    } catch (err) { /* 忽略单次失败 */ }
  }
  setTimeout(function(){ if (_view2 === "live") pollLive(); }, 2000);
}

/* ========== 仪表盘(纯量化指标) ========== */
async function loadDash() {
  _view = "dash";
  const anomaliesP = api("/api/v2/anomalies").catch(() => null);
  const d = await api("/api/dash");
  // 异常优先渲染(不等量化数据)
  try {
    var an = await anomaliesP;
    renderAnomalies(an && an.anomalies || []);
  } catch { /* ignore */ }
  // 冷启动引导: extension未生效时一次性显示(可关闭)
  try {
    var live0 = await api("/api/live");
    if (!live0.active && !window.localStorage.getItem("hm-onboarded")) {
      var host = document.getElementById("anomaly-bar");
      if (host) host.insertAdjacentHTML("afterbegin",
        '<div class="panel" style="border-left:3px solid var(--accent);padding:10px 14px;margin-bottom:8px">' +
        '<h2 style="font-size:14px">👋 首次使用引导 (3步开启完整能力)</h2>' +
        '<ol style="font-size:13px;line-height:1.9;margin:6px 0 0 18px">' +
        '<li><b>重启 pi 会话</b> — harness-manager 已作为 pi 包安装, 重启后 extension 自动生效(记录思考流/技能触发/工具结果)</li>' +
        '<li><b>正常使用 pi 工作</b> — 触发统计/错误率/上下文实测数据将自动积累</li>' +
        '<li><b>回到这里查看</b> — 💬会话历史(审查回放) / ⌨实时监控(思考流) / 🧠技能中心(启停与分诊)</li>' +
        '</ol>' +
        '<button class="op" style="margin-top:8px" onclick="dismissOnboard()">我知道了</button>' +
        '</div>');
    }
  } catch(e) {}
  const c1 = [
    { n: d.resources.skills, l: "技能总数" },
    { n: d.sessions.total, l: "会话数" },
    { n: fmt(d.tokens.total), l: "token 总量" },
    { n: fmt(d.sessions.tools), l: "工具调用" },
    { n: d.triggers.total, l: "技能触发" },
    { n: d.reliability.quantified, l: "已量化会话" },
  ].map((x) => '<div class="card"><div class="num">' + x.n + '</div><div class="label">' + x.l + "</div></div>").join("");
  const hSum = d.skillsHealth.summary?.byLevel || {};
  const rel = d.reliability || {};
  const topTrig = (d.triggers.top || []).map((t) => "<tr><td>" + esc(t.name) + '</td><td><b>' + t.count + "</b></td></tr>").join("");
  const byModel = (d.tokens.byModel || []).map((m) => "<tr><td>" + esc(m.model) + "</td><td>" + fmt(m.input) + "</td><td>" + fmt(m.output) + "</td></tr>").join("");
  const srcTags = Object.entries(d.resources.bySource || {}).map(([k,v])=>'<span class="tag" style="margin-right:6px">' + esc(k)+":"+v + "</span>").join("");
  var anomalyHtml = "";
    try { var ah = document.getElementById("anomaly-bar"); } catch(e) {}
    $("#content").innerHTML =
    '<div id="anomaly-bar"></div>' +
    '<div class="cards">' + c1 + "</div>" +
    '<div class="row">' +
      '<div class="panel"><h2>可靠性量化</h2>' +
        '<p>已量化 ' + rel.quantified + ' 会话 · 平均错误率 <a href="#" onclick="showReliability();return false;"><b>' + rel.avgErrorRate + '%</b></a> · 平均重试率 <b>' + rel.avgRetryRate + '%</b></p>' +
        '<p style="margin-top:6px"><span class="tag green">A:' + (rel.grades?.A||0) + '</span> <span class="tag yellow">B:' + (rel.grades?.B||0) + '</span> <span class="tag red">C:' + (rel.grades?.C||0) + " D:" + (rel.grades?.D||0) + '</span>' +
        ' <button class="op" onclick="showReliability()">🔍 下钻明细</button></p>' +
      "</div>" +
      '<div class="panel"><h2>技能健康</h2>' +
        '<p>🟢 ' + (hSum.healthy||0) + " 健康 · 🟡 " + (hSum.attention||0) + " 需关注 · 🔴 " + (hSum.risk||0) + " 风险</p>" +
        '<p class="muted" style="margin-top:6px">来源: ' + srcTags + "</p>" +
      "</div>" +
    "</div>" +
    '<div class="row">' +
      '<div class="panel"><h2>模型评估 (综合分=效率30%+质量45%+稳定25%)</h2><div id="model-eval">加载中…</div></div>' +
      '<div class="panel"><h2>Token 按模型</h2><table><thead><tr><th>模型</th><th>in</th><th>out</th></tr></thead><tbody>' + byModel + "</tbody></table></div>" +
      '<div class="panel"><h2>技能触发 Top</h2><table><thead><tr><th>技能</th><th>次数</th></tr></thead><tbody>' + (topTrig || '<tr><td colspan="2" class="muted">暂无(重启pi会话后记录)</td></tr>') + "</tbody></table></div>" +
    "</div>";
  // 模型评估渲染
  api('/api/v2/model-eval').then(function(me){
    var host = document.getElementById('model-eval');
    if (!host) return;
    if (!me.models || !me.models.length) { host.innerHTML = '<span class="muted">无模型数据</span>'; return; }
    host.innerHTML = '<table style="font-size:12px"><thead><tr><th>模型</th><th>评分</th><th>会话</th><th>tok/turn</th><th>错误率</th><th>成效</th></tr></thead><tbody>' +
      me.models.map(function(m){
        var sc = m.score != null ? '<b>' + m.score + '</b>' : '<span class="muted">—</span>';
        var tag = m.sampleNote.indexOf('充足') >= 0 ? ' <span class="tag green">样本足</span>' : '';
        return '<tr><td>' + esc(m.model) + tag + '</td><td>' + sc + '</td><td>' + m.sessions + '</td>' +
          '<td>' + (m.tokensPerTurn != null ? fmt(m.tokensPerTurn) : '—') + '</td>' +
          '<td>' + (m.errorRate * 100).toFixed(1) + '%</td>' +
          '<td>' + (m.avgOutcome != null ? m.avgOutcome : '—') + '</td></tr>';
      }).join('') + '</tbody></table>' +
      '<p class="muted" style="font-size:11px;margin-top:6px">综合分=效率30%+质量45%+稳定25%; 样本少的模型结论参考性有限。公平对比请在同一项目跑同类任务。</p>';
  }).catch(function(){});
}

function dismissOnboard() {
  try { window.localStorage.setItem("hm-onboarded", "1"); } catch(e) {}
  var el = document.querySelector("#anomaly-bar .panel");
  if (el) el.remove();
}

function renderAnomalies(list) {
  window._lastAnomalies = list;
  var host = document.getElementById("anomaly-bar");
  if (!host) return;
  if (!host) return;
  if (!list.length) {
    host.innerHTML = '<div class="panel" style="border-color:var(--green);padding:10px 14px"><span class="tag green">✓ 无异常</span> <span class="muted" style="font-size:12px">错误率/重试/空转/技能冲突/token离群 全部正常</span></div>';
    return;
  }
  var colors = { critical: "var(--red)", warning: "var(--yellow)", info: "var(--muted)" };
  var html = list.map(function(a){
    var icon = a.level === "critical" ? "🔴" : a.level === "warning" ? "🟡" : "⚪";
    return '<div class="panel" style="padding:8px 12px;margin-bottom:6px;border-left:3px solid ' + (colors[a.level]||"var(--muted)") + '">' +
      icon + ' <b>' + esc(a.title) + '</b>' +
      ' <span class="muted" style="font-size:12px">' + esc(a.detail) + '</span>' +
      (a.sessionId ? ' <button class="op" onclick="showReview(\''+esc(a.sessionId)+'\')">查看现场</button>' : "") +
      (a.actionHint ? ' <div class="muted" style="font-size:11px;margin-top:2px">→ ' + esc(a.actionHint) + "</div>" : "") +
    "</div>";
  }).join("");
  host.innerHTML = '<div style="margin-bottom:16px"><h2 style="font-size:15px;margin-bottom:6px">🚨 异常发现 (' + list.length + ')</h2>' + html + "</div>";
}

/* ========== 技能中心 ========== */
async function loadSkills() {
  _view = "skills";
  var pair = await Promise.all([api("/api/skills"), api("/api/v2/skill-usage-triage").catch(function(){return [];})]);
  const d = pair[0];
  var usageMap = {};
  (pair[1]||[]).forEach(function(u){ usageMap[u.skill] = u; });
  const catFilter = document.getElementById("cat-filter")?.value || "all";
  const usageFilter = document.getElementById("usage-filter")?.value || "all";
  const q = (document.getElementById("skill-q")?.value || "").toLowerCase();
  let list = (d.skills || []).map(function(x){
    var u = usageMap[x.name];
    x.usageState = u ? u.state : "active-unused";
    x.triggerReal = u ? u.triggerCount : x.triggerCount;
    return x;
  });
  if (catFilter !== "all") list = list.filter((x) => x.category === catFilter);
  if (usageFilter !== "all") list = list.filter((x) => x.usageState === usageFilter);
  if (q) list = list.filter((x) => (x.name + " " + (x.cnName||"") + " " + (x.what||"") + " " + (x.outcome||"")).toLowerCase().includes(q));
  const cats = [...new Set((d.skills||[]).map((x) => x.category))].sort();
  const opts = '<option value="all">全部分类</option>' + cats.map((c)=>'<option value="' + esc(c) + '">' + esc(c) + "</option>").join("");
  const rows = list.map((x) =>
    "<tr>" +
    '<td><a href="#" onclick="showSkillCard(\'' + esc(x.name) + '\');return false;">' + esc(x.name) + "</a></td>" +
    '<td class="muted">' + esc(x.cnName||"") + "</td>" +
    '<td><span class="tag" style="background:#242933;color:var(--accent)">' + esc(x.categoryIcon||"") + " " + esc(x.category||"") + "</span></td>" +
    "<td>" + esc(x.source) + ":" + esc(x.scope) + "</td>" +
    "<td>" + statusTag(x.status, x.migratedTo) + "</td>" +
    "<td>" + (x.enabled ? '<span class="tag green">启用</span>' : '<span class="tag red">禁用</span>') + "</td>" +
    "<td>" + (x.triggerReal ? "<b>"+x.triggerReal+"</b>" : '<span class="muted">0</span>') + "</td>" +
    "<td>" + (x.usageState==="active-used" ? '<span class="tag green">在用</span>' : x.usageState==="low-usage" ? '<span class="tag yellow">低频</span>' : x.usageState==="disabled" ? '<span class="tag red">已禁用</span>' : '<span class="tag red">未用</span>') + "</td>" +
    "<td>" + (x.healthScore!=null ? (x.healthLevel==="healthy"?"🟢":x.healthLevel==="attention"?"🟡":"🔴")+" "+x.healthScore : "—") + "</td>" +
    '<td class="muted">' + esc((x.what||"").slice(0,40)) + "</td>" +
    "<td>" +
      '<button class="op" title="'+(x.enabled?"从 agent 上下文移除":"恢复加载")+'" onclick="toggleSkill(\'' + esc(x.name) + "'," + !x.enabled + ')">' + (x.enabled?"禁用":"启用") + "</button>" +
      '<button class="op" onclick="showSkillCard(\'' + esc(x.name) + '\')">详情</button>' +
    "</td>" +
    "</tr>").join("");
  $("#content").innerHTML = '<div class="panel">' +
    '<div style="margin:6px 0;display:flex;gap:8px;align-items:center;flex-wrap:wrap">' +
      '<input id="skill-q" placeholder="搜索技能/说明…" oninput="loadSkills()" style="flex:1;min-width:160px;background:#242933;color:var(--fg);border:1px solid var(--line);border-radius:8px;padding:6px 10px">' +
      '<select id="cat-filter" onchange="loadSkills()" style="background:#242933;color:var(--fg);border:1px solid var(--line);border-radius:6px;padding:4px 8px">' + opts + "</select>" +
      '<select id="usage-filter" onchange="loadSkills()" style="background:#242933;color:var(--fg);border:1px solid var(--line);border-radius:6px;padding:4px 8px">' +
        '<option value="all">全部使用度</option><option value="active-unused">未用</option><option value="low-usage">低频</option><option value="active-used">在用</option><option value="disabled">已禁用</option></select>' +
      '<span class="muted" style="font-size:12px">共 ' + list.length + ' 个</span>' +
    "</div>" +
    '<table><thead><tr><th>名称</th><th>中文名</th><th>分类</th><th>来源</th><th>状态</th><th>启停</th><th>触发</th><th>健康</th><th>说明</th><th>操作</th></tr></thead><tbody>' + rows + "</tbody></table>" +
    '<p class="muted" style="font-size:11px;margin-top:8px">启停=真控制: 禁用后 pi 在下一回合把该技能从系统提示移除(agent 不再看见)。</p>' +
  "</div>";
}

async function toggleSkill(name, enable) {
  await fetch("/api/skills/toggle", { method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify({ name, enabled: enable }) });
  toast((enable ? "✓ 已启用 " : "✓ 已禁用 ") + name + "(下一回合对 agent 生效)");
  loadSkills();
}

async function showSkillCard(name) {
  const d = await api("/api/skills").then((r)=>(r.skills||[]).find((x)=>x.name===name));
  if (!d) return toast("未找到 "+name);
  let overlay = document.getElementById("skill-modal");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "skill-modal";
    overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;z-index:998";
    document.body.appendChild(overlay);
  }
  overlay.innerHTML =
    '<div style="background:var(--card);border:1px solid var(--line);border-radius:12px;padding:22px;max-width:560px;width:92%">' +
    '<h2>📌 ' + esc(d.cnName||d.name) + ' <span class="muted" style="font-size:13px;font-weight:normal">' + esc(d.name) + "</span></h2>" +
    '<p class="muted" style="margin:6px 0">' + esc(d.categoryIcon||"") + " " + esc(d.category||"-") + " · " + esc(d.source) + ":" + esc(d.scope) + " · 触发 " + (d.triggerCount??0) + " 次" + (d.healthScore!=null?(" · 健康 "+d.healthScore):"") + "</p>" +
    '<p style="margin:10px 0"><b>① 是做什么的:</b> ' + esc(d.what||"(无)") + "</p>" +
    '<p style="margin:10px 0"><b>② 何时用:</b> ' + esc(d.when||d.description||"(无)") + "</p>" +
    '<p style="margin:10px 0"><b>③ 达成什么:</b> ' + esc(d.outcome||"(无)") + "</p>" +
    ((d.issues&&d.issues.length)?'<p style="margin:10px 0;color:var(--yellow)"><b>健康提示:</b> ' + esc(d.issues.join("; ")) + "</p>":"") +
    '<div style="display:flex;gap:8px;margin-top:14px">' +
      '<button class="op" onclick="toggleSkill(\'' + esc(name) + "'," + !d.enabled + ');document.getElementById(\'skill-modal\').remove()">' + (d.enabled?"禁用此技能":"启用此技能") + "</button>" +
      '<button class="op" onclick="document.getElementById(\'skill-modal\').remove()">关闭</button>' +
    "</div></div>";
}

/* ========== 会话中心 ========== */
var sessTimer = null;
var _view = "sessions"; // 当前子视图: sessions(列表) / review(审查回放), 轮询只在 sessions 时继续
var _sessSort = "active"; // active/started/tokens
function setSessSort(mode) {
  _sessSort = mode;
  loadSessionsPage();
}
var _sessFingerprint = ""; // 数据指纹, 无变化不重渲染(防轮询闪烁)
var _sessView = "flat"; // flat=列表 / group=按项目分组
async function loadSessionsPage() {
  _view = "sessions";
  var pair = await Promise.all([api("/api/v2/sessions?sort=" + _sessSort), api("/api/v2/fleet")]);
  var list = pair[0] || [];
  var fleet = pair[1] || {};
  // 指纹防闪: 无变化跳过重渲染
  var fp = _sessSort + "|" + _sessView + "|" + list.length + "|" + ((list[0] && list[0].ended_at) || "");
  if (fp === _sessFingerprint && document.getElementById("sess-table")) {
    document.querySelectorAll(".sort-btn").forEach(function(x){ x.classList.toggle("active-tab", x.dataset.sort === _sessSort); });
    document.querySelectorAll(".view-btn").forEach(function(x){ x.classList.toggle("active-tab", x.dataset.view === _sessView); });
    return;
  }
  _sessFingerprint = fp;
  var rows = list.slice(0,80).map(function(s){
    var st = s.stats || {};
    var degradedTag = s.degraded ? ' <span class="tag red">降级</span>' : "";
    return "<tr>" +
      '<td><a href="#" onclick="showReview(\''+esc(s.id)+'\');return false;" class="mono">'+esc(s.id.slice(s.id.indexOf(":")+1, s.id.indexOf(":")+19))+"</a></td>" +
      "<td>"+esc(s.harness)+"</td>" +
      "<td>"+esc((s.started_at||"").slice(0,10))+"</td>" +
      "<td>"+(st.turns||0)+"t/"+(st.tools||0)+"🛠/"+(st.thinking||0)+"💭</td>" +
      "<td>"+((st.tokensIn||st.tokensOut)?fmt(st.tokensIn+st.tokensOut):"—")+"</td>" +
      "<td>"+(s.model?esc(s.model):'—')+"</td>" +
      '<td class="muted">'+esc((s.cwd||"").slice(-30))+degradedTag+"</td>" +
    "</tr>";
  }).join("");
  var sb = document.querySelectorAll(".sort-btn");
    sb.forEach(function(x){ x.classList.toggle("active-tab", x.dataset.sort === _sessSort); });
    var viewBtns =
      '<span class="muted" style="font-size:12px;margin-left:8px">视图:</span>' +
      '<button class="op view-btn" data-view="flat">列表</button>' +
      '<button class="op view-btn" data-view="group">📁 按项目</button>';
    var tableHtml;
    if (_sessView === "group") {
      var byProject = {};
      list.forEach(function(s){
        var key = (s.cwd || "(unknown)").replace(/[\/]+$/, "");
        (byProject[key] = byProject[key] || []).push(s);
      });
      var keys = Object.keys(byProject).sort(function(a,b){
        var ma = Math.max.apply(null, byProject[a].map(function(x){return new Date(x.ended_at||x.started_at||0).getTime();}));
        var mb = Math.max.apply(null, byProject[b].map(function(x){return new Date(x.ended_at||x.started_at||0).getTime();}));
        return mb - ma;
      });
      tableHtml = keys.map(function(k){
        var sess = byProject[k];
        var gid = "pg_" + k.replace(/[^a-zA-Z0-9]/g, "_");
        var totTok = sess.reduce(function(a,s2){ var st2=s2.stats||{}; return a + (st2.tokensIn||0)+(st2.tokensOut||0); }, 0);
        return '<div class="panel" style="padding:8px 12px;margin-bottom:8px">' +
          '<div style="cursor:pointer" onclick="toggleProjectGroup(\'' + gid + '\')">' +
          '<b>📁 ' + esc(k) + '</b> <span class="muted" style="font-size:12px">' + sess.length + ' 会话 · ' + fmt(totTok) + ' token</span></div>' +
          '<div id="' + gid + '" style="display:none;margin-top:6px">' +
          sess.map(function(s2){ var st2=s2.stats||{};
            return '<div style="font-size:12px;margin:3px 0 3px 12px">' +
            '<a href="#" onclick="showReview(\''+esc(s2.id)+'\');return false;" class="mono">' + esc(s2.id.slice(s2.id.indexOf(":")+1)) + '</a>' +
            ' <span class="muted">' + esc((s2.started_at||"").slice(0,10)) + ' · ' + (st2.turns||0) + 't/' + (st2.tools||0) + '🛠 · ' + fmt((st2.tokensIn||0)+(st2.tokensOut||0)) + ' tok</span></div>'; }).join("") +
          '</div></div>';
      }).join("");
    } else {
      tableHtml = '<table id="sess-table"><thead><tr><th>id</th><th>harness</th><th>日期</th><th>turn/工具/思考</th><th>token</th><th>模型</th><th>项目</th></tr></thead><tbody>' + (rows || '<tr><td colspan="7" class="muted">暂无。点击右上"🔄刷新数据"</td></tr>') + '</tbody></table>';
    }
    $("#content").innerHTML =
    '<div class="panel"><h2>会话历史 (统一库: '+list.length+' 会话 · 全局等级 <span class="tag yellow">'+(fleet.globalGrade||"-")+'</span> · 错误率 '+(fleet.errorRate*100).toFixed(1)+'%)</h2>' +
      '<div style="margin:6px 0;display:flex;gap:6px;align-items:center">' +
        '<span class="muted" style="font-size:12px">排序:</span>' +
        '<button class="op sort-btn" data-sort="active">🟢 最后活跃</button>' +
        '<button class="op sort-btn" data-sort="started">🕐 开始时间</button>' +
        '<button class="op sort-btn" data-sort="tokens">💰 token消耗</button>' +
        '<span class="muted" style="font-size:12px;margin-left:8px">视图:</span>' +
        '<button class="op view-btn" data-view="flat">列表</button>' +
        '<button class="op view-btn" data-view="group">📁 按项目</button>' +
      '</div>' +
      tableHtml + '</div>';
  document.querySelectorAll(".view-btn").forEach(function(x){ x.classList.toggle("active-tab", x.dataset.view === _sessView); });
}
function toggleProjectGroup(gid) {
  var el = document.getElementById(gid);
  if (el) el.style.display = el.style.display === "none" ? "block" : "none";
}

var _reviewData = null; // 当前审查回放数据(分批渲染)
var _reviewShown = 0;
function renderTurnBatch(list, from, to) {
  return list.slice(from, to).map(function(t){
    var think=(t.thinking||[]).map(function(th){return '<div style="color:#d8c48a;font-size:12px;margin:2px 0">💭 '+esc((th.text||"").replace(/\s+/g," ").slice(0,140))+"…</div>";}).join("");
    var tools=(t.tools||[]).slice(0,6).map(function(tc){return '<div style="color:var(--accent);font-size:12px">🛠 '+esc(tc.name)+' <span class="muted">'+esc(tc.input||"")+"</span></div>";}).join("")+((t.tools.length>6)?'<div class="muted" style="font-size:11px">…共'+t.tools.length+"个</div>":"");
    var out=(t.textOutput&&t.textOutput[0])?'<div class="muted" style="font-size:12px;margin:3px 0">↩ '+esc(String(t.textOutput[0]).replace(/\s+/g," ").slice(0,110))+"</div>":"";
    return '<div class="panel" style="margin:8px 0;padding:10px 14px;border-left:3px solid var(--line)">' +
      '<div><b>[turn '+t.index+']</b> <span class="muted">'+esc((t.ts||"").slice(11,19))+'</span> '+esc((t.userInput||"").slice(0,80))+
      ' <span class="tag" style="margin-left:8px">所见: '+(t.contextAtTurn?t.contextAtTurn.messages:'?')+'msg/'+(t.contextAtTurn?t.contextAtTurn.thinking:'?')+'💭/'+(t.contextAtTurn?t.contextAtTurn.tools:'?')+'🛠</span></div>' +
      think+tools+out+'</div>';
  }).join("");
};
function loadMoreTurns() {
  var container = document.getElementById("turns-body");
  if (!container || !_reviewData) return;
  var list = (_reviewData.turns && _reviewData.turns.list) || [];
  var total = _reviewData.turns ? _reviewData.turns.total : 0;
  var next = Math.min(_reviewShown + 25, total);
  var btn = document.getElementById("load-more-btn");
  if (btn) btn.remove();
  container.insertAdjacentHTML("beforeend", renderTurnBatch(list, _reviewShown, next));
  _reviewShown = next;
  if (_reviewShown < total) {
    container.insertAdjacentHTML("beforeend", '<div id="load-more-btn" style="text-align:center;margin:10px"><button class="op" onclick="loadMoreTurns()">' + "显示更多 ("+_reviewShown+"/"+total+")</button></div>");
  }
};

async function showReview(id) {
  _view = "review";
  if (location.hash !== "#/review/" + encodeURIComponent(id)) location.hash = "#/review/" + encodeURIComponent(id);
  toast("加载审查回放…");
  var triple = await Promise.all([
    api("/api/v2/review?id=" + encodeURIComponent(id)),
    api("/api/v2/summary?id=" + encodeURIComponent(id)).catch(function(){return null;}),
    api("/api/v2/context?id=" + encodeURIComponent(id)).catch(function(){return null;})
  ]);
  var r = triple[0], sum = triple[1], ctxSeries = triple[2] || [];
  if (!r) return toast("未找到该会话(先点右上角刷新数据同步)");

  // 缓存供各tab渲染
  window._rv = { id: id, r: r, sum: sum, ctx: ctxSeries };

  // 统一数据结构(turns 供分批)
  _reviewData = { turns: { total: r.totals.turns, list: r.turns.map(function(t){
    return { index: t.index, ts: t.ts, userInput: t.userInput,
             thinking: (t.thinking||[]).map(function(th){return {text: th.text};}),
             tools: (t.tools||[]).map(function(tc){return {name: tc.name, input: typeof tc.input==="string"?tc.input:JSON.stringify(tc.input), durationMs: tc.durationMs, error: tc.error};}),
             textOutput: [], contextAtTurn: t.contextBefore };
  })}};
  _reviewShown = 0;

  var hdr =
    '<button onclick="loadSessionsPage()" style="background:none;border:none;color:var(--accent);cursor:pointer;margin-bottom:10px">← 返回列表</button>' +
    '<div class="panel" style="padding:10px 14px"><b>' + esc(r.session.harness) + ' · ' + esc((r.session.started_at||"").slice(0,16)) + '</b> <span class="muted" style="font-size:12px">' + esc(r.session.cwd||"") + (r.session.degraded?' · <span class="tag red">降级</span>':"") + '</span></div>' +
    '<div style="display:flex;gap:6px;margin:10px 0;flex-wrap:wrap">' +
      '<button class="op active-tab" id="tab-overview" onclick="rvTab(\'overview\')">📋 概览</button>' +
      '<button class="op" id="tab-replay" onclick="rvTab(\'replay\')">🧠 推理回放</button>' +
      '<button class="op" id="tab-context" onclick="rvTab(\'context\')">📐 上下文</button>' +
      '<button class="op" id="tab-config" onclick="rvTab(\'config\')">⚙ 配置</button>' +
    '</div>' +
    '<div id="rv-body" style="max-height:75vh;overflow-y:auto"></div>';
  $("#content").innerHTML = hdr;
  rvTab("overview");
}

window._rvScroll = {}; // 各tab滚动位置
window._rvCurTab = null;
function rvTab(tab) {
  var v = window._rv;
  if (!v) return;
  // 保存离开的tab滚动位置
  var cur = document.getElementById("rv-body");
  if (cur && window._rvCurTab) window._rvScroll[window._rvCurTab] = cur.scrollTop;
  ["overview","replay","context","config"].forEach(function(t){
    var el = document.getElementById("tab-"+t);
    if (el) el.classList.toggle("active-tab", t === tab);
  });
  window._rvCurTab = tab;
  if (tab === "overview") rvOverview(v);
  else if (tab === "replay") rvReplay(v);
  else if (tab === "context") rvContext(v);
  else if (tab === "config") rvConfig(v);
  // 恢复滚动位置
  requestAnimationFrame(function(){
    var body = document.getElementById("rv-body");
    if (body) body.scrollTop = window._rvScroll[tab] || 0;
  });
}

/* ---- 概览 ---- */
function rvOverview(v) {
  var r = v.r, sum = v.sum;
  var cards =
    '<div class="cards">' +
      '<div class="card"><div class="num">'+r.totals.turns+'</div><div class="label">turns</div></div>' +
      '<div class="card"><div class="num">'+fmt(r.totals.tools)+'</div><div class="label">工具调用</div></div>' +
      '<div class="card"><div class="num">'+fmt(r.totals.thinkingBlocks)+'</div><div class="label">思考块</div></div>' +
      '<div class="card"><div class="num">'+fmt((r.totals.tokensIn||0)+(r.totals.tokensOut||0))+'</div><div class="label">token</div></div>' +
    '</div>';
  var sumHtml = (sum ? (
    '<div class="panel" style="border-left:3px solid var(--accent)">' +
      '<h2>🧾 这段时间 agent 干了什么</h2>' +
      '<p style="margin:6px 0"><b>' + esc(sum.headline || "") + '</b></p>' +
      '<p class="muted" style="font-size:12px">动作: ' + (sum.actions ? '写'+sum.actions.write+' · 读'+sum.actions.read+' · 执行'+sum.actions.exec+' · 检索'+sum.actions.search+' · 规划'+sum.actions.plan : "-") + '</p>' +
      ((sum.touchedFiles&&sum.touchedFiles.length) ? '<p class="muted" style="font-size:12px">改动文件 ('+sum.touchedFiles.length+'): '+esc(sum.touchedFiles.slice(0,8).join(" · "))+(sum.touchedFiles.length>8?" …":"")+'</p>' : "") +
      ((sum.topTools&&sum.topTools.length) ? '<p class="muted" style="font-size:12px">高频工具: '+esc(sum.topTools.slice(0,5).map(function(t){return t.name+"×"+t.count}).join(" · "))+'</p>' : "") +
    '</div>') : "");
  document.getElementById("rv-body").innerHTML = cards + sumHtml;
}

/* ---- 推理回放 ---- */
function rvReplay(v) {
  var list = _reviewData.turns.list;
  var first = renderTurnBatch(list, 0, Math.min(25, list.length));
  _reviewShown = Math.min(25, list.length);
  var moreBtn = (_reviewShown < list.length) ? '<div id="load-more-btn" style="text-align:center;margin:10px"><button class="op" onclick="loadMoreTurns()">' + "显示更多 ("+_reviewShown+"/"+list.length+")</button></div>" : "";
  document.getElementById("rv-body").innerHTML =
    '<div class="panel"><h2>🧠 推理回放 ('+_reviewData.turns.total+' turns — 思考为什么/工具做什么/当时所见)</h2></div>' +
    '<div id="turns-body" style="max-height:70vh;overflow:auto">'+first+moreBtn+"</div>";
}

/* ---- 上下文 ---- */
function rvContext(v) {
  var cs = v.ctx || [];
  if (!cs.length) { document.getElementById("rv-body").innerHTML = '<div class="panel"><p class="muted">暂无上下文快照(需要 extension config_snapshot 事件)</p></div>'; return; }
  var bars = cs.map(function(c){
    var sp=c.systemPromptTokens||0, hi=c.historyTokens||0, tr=c.toolResultTokens||0, fc=c.fileContentTokens||0;
    var total=sp+hi+tr+fc; if(total<=0) return "";
    var seg=function(v2,color,label){ return v2>0?'<div style="display:inline-block;height:14px;width:'+(v2/total*100).toFixed(1)+'%;background:'+color+'" title="'+label+': '+fmt(v2)+' tok ('+(v2/total*100).toFixed(0)+'%)"></div>':""; };
    return '<div style="margin:4px 0"><span class="muted mono" style="font-size:11px">T'+c.turnIdx+'</span>' +
      '<div style="display:flex;width:100%;border-radius:3px;overflow:hidden">' +
      seg(sp,'#5db4ff','system prompt')+seg(hi,'#d8c48a','history')+seg(tr,'#3fb950','tool result')+seg(fc,'#d2a8ff','file content')+
      '</div><span class="muted" style="font-size:10px">≈'+fmt(total)+' tok</span></div>';
  }).join("");
  // token 表(采样)
  var tblRows = cs.filter(function(c,idx){ return idx % Math.max(1, Math.ceil(cs.length/15)) === 0 || idx === cs.length-1; }).map(function(c){
    return "<tr><td>T"+c.turnIdx+"</td><td>"+fmt(c.systemPromptTokens||0)+"</td><td>"+fmt(c.historyTokens||0)+"</td><td>"+fmt(c.toolResultTokens||0)+"</td><td>"+fmt(c.fileContentTokens||0)+"</td></tr>";
  }).join("");
  document.getElementById("rv-body").innerHTML =
    '<div class="panel"><h2>📐 上下文构成演变</h2>' +
      '<p class="muted" style="font-size:11px">蓝=系统提示 黄=历史消息 绿=工具返回 紫=文件内容 (估算口径 chars/3)</p>' + bars + "</div>" +
    '<div class="panel"><h2>Token 构成明细(采样)</h2><table><thead><tr><th>turn</th><th>系统提示</th><th>历史</th><th>工具返回</th><th>文件</th></tr></thead><tbody>'+tblRows+'</tbody></table></div>';
}

/* ---- 配置 ---- */
function rvConfig(v) {
  var r = v.r;
  var c = r.agentConfig;
  var body = c ? (
    '<div class="cards">' +
      '<div class="card"><div class="num mono" style="font-size:16px">'+esc(c.version_hash)+'</div><div class="label">版本 hash</div></div>' +
      '<div class="card"><div class="num" style="font-size:16px">'+esc(c.model||"-")+'</div><div class="label">模型</div></div>' +
      '<div class="card"><div class="num">'+(c.skills_loaded||[]).length+'</div><div class="label">加载技能</div></div>' +
      '<div class="card"><div class="num">'+(c.allowed_tools||[]).length+'</div><div class="label">授权工具</div></div>' +
    '</div>' +
    '<div class="panel"><h2>技能列表</h2><p>' + ((c.skills_loaded||[]).map(esc).join(" · ") || '<span class="muted">无</span>') + '</p></div>' +
    '<div class="panel"><h2>授权工具</h2><p>' + ((c.allowed_tools||[]).map(esc).join(" · ") || '<span class="muted">无</span>') + '</p></div>' +
    '<div class="panel"><h2>System Prompt (' + esc(String((c.system_prompt||"").length)) + ' 字符)</h2>' +
      '<div class="trace" style="max-height:40vh">' + esc(c.system_prompt||"") + "</div></div>"
  ) : '<div class="panel"><p class="muted">无配置快照。重启 pi 会话后 extension 会在每个回合记录 config_snapshot 事件自动生成。</p></div>';
  document.getElementById("rv-body").innerHTML = body;
}

async function loadUsage() {
  const u = await api("/api/usage");
  const topSkill = Object.entries(u.bySkill || {}).sort((a, b) => b[1] - a[1]).slice(0, 20);
  const max = Math.max(1, ...topSkill.map(([, v]) => v));
  const bars = topSkill.map(([k, v]) => `<div style="margin:6px 0"><span>${esc(k)}</span> <span class="muted">×${v}</span>
    <div class="bar"><div style="width:${(v / max * 100).toFixed(1)}%"></div></div></div>`).join("");
  const recent = (u.recent || []).slice(0, 15).map((t) => `<div style="margin:3px 0"><span class="muted">${esc((t.ts||"").slice(11,19))}</span> [${esc((t.skills||[]).join(","))}] <span class="muted">@ ${esc((t.cwd||"").slice(0,40))}</span></div>`).join("");
  $("#content").innerHTML = `
    <div class="row">
      <div class="panel"><h2>技能触发统计 (${u.totalTriggers || 0})</h2>${bars || '<p class="muted">暂无触发记录。重启 pi 会话后 extension 会记录每个回合加载的技能。</p>'}</div>
      <div class="panel"><h2>按项目</h2>${Object.entries(u.byProject || {}).sort((a,b)=>b[1]-a[1]).map(([k,v]) => `<div>${esc(k)}: <b>${v}</b></div>`).join("") || '<p class="muted">无</p>'}</div>
    </div>
    <div class="panel"><h2>最近触发记录（时间/技能/项目）</h2>${recent || '<p class="muted">无</p>'}</div>`;
}

$("#nav").addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b) return;
  location.hash = "#/" + b.dataset.page; // 路由驱动(触发hashchange)
});

// hash 路由: 解析 -> 渲染
function applyRoute() {
  var h = location.hash.replace(/^#\/?/, ""); // #/sessions -> sessions
  if (h.indexOf("review/") === 0) {
    // #/review/<id>
    var id = decodeURIComponent(h.slice("review/".length));
    var b = document.querySelector('#nav button[data-page="sessions"]');
    if (b) { document.querySelectorAll("#nav button").forEach(function(x){x.classList.remove("active")}); b.classList.add("active"); }
    if (b.dataset.page !== "live") _view2 = "";
    _view = "review";
    showReview(id);
    return;
  }
  var page = h || "dash";
  if (!pages[page]) page = "dash";
  document.querySelectorAll("#nav button").forEach(function(x){ x.classList.toggle("active", x.dataset.page === page); });
  if (page !== "live") _view2 = "";
  _view = page === "sessions" ? "sessions" : page === "dash" ? "dash" : page;
  pages[page]();
}
window.addEventListener("hashchange", applyRoute);

// 会话排序/视图按钮(事件委托)
document.addEventListener("click", function(ev) {
  var b = ev.target.closest(".sort-btn");
  if (b) { _sessSort = b.dataset.sort; loadSessionsPage(); return; }
  var vb = ev.target.closest(".view-btn");
  if (vb) { _sessView = vb.dataset.view; loadSessionsPage(); }
});

async function rescanNow() {
  const btn = document.getElementById("rescan-btn");
  btn.textContent = "⟳ 扫描中…";
  const r = await fetch("/api/rescan", { method: "POST" }).then((x) => x.json()).catch(() => null);
  btn.textContent = "🔄 刷新数据";
  if (r && r.ok) toast("✓ 已重扫: " + r.sessions + " 会话 / " + r.resources + " 资源(重新载入当前页)");
  else { toast("扫描失败"); return; }
  // 重载当前页展示新数据
  const active = document.querySelector("nav button.active");
  if (active && pages[active.dataset.page]) pages[active.dataset.page]();
}

applyRoute();
