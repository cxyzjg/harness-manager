import { readFileSync, writeFileSync } from "node:fs";
const p = "src/web/index.html";
let s = readFileSync(p, "utf-8");

// 仪表盘加"模型评估"区(在技能触发Top旁)
const oldBlock = `    '<div class="row">' +
      '<div class="panel"><h2>Token 按模型</h2><table><thead><tr><th>模型</th><th>in</th><th>out</th></tr></thead><tbody>' + byModel + "</tbody></table></div>" +`;
if (!s.includes(oldBlock)) { console.error("token block not found"); process.exit(1); }
const newBlock = `    '<div class="row">' +
      '<div class="panel"><h2>模型评估 (综合分 = 效率30%+质量45%+稳定25%)</h2><div id="model-eval">加载中…</div></div>' +
      '<div class="panel"><h2>Token 按模型</h2><table><thead><tr><th>模型</th><th>in</th><th>out</th></tr></thead><tbody>' + byModel + "</tbody></table></div>" +`;
s = s.replace(oldBlock, newBlock);

// loadDash 尾部拉取模型评估渲染
const anchor = `    "</div>";
  // 恢复异常区(content被innerHTML整体覆盖后)
  try { renderAnomalies(window._lastAnomalies || []); } catch(e) {}
}`;
if (!s.includes(anchor)) { console.error("dash tail not found"); process.exit(1); }
const newTail = `    "</div>";
  // 恢复异常区(content被innerHTML整体覆盖后)
  try { renderAnomalies(window._lastAnomalies || []); } catch(e) {}
  // 模型评估渲染
  api("/api/v2/model-eval").then(function(me){
    var host = document.getElementById("model-eval");
    if (!host) return;
    if (!me.models || !me.models.length) { host.innerHTML = '<span class="muted">无模型数据</span>'; return; }
    host.innerHTML = '<table style="font-size:12px"><thead><tr><th>模型</th><th>评分</th><th>会话</th><th>tok/turn</th><th>错误率</th><th>成效</th></tr></thead><tbody>' +
      me.models.map(function(m){
        var sc = m.score != null ? '<b>' + m.score + '</b>' : '<span class="muted">—</span>';
        var gradeTag = m.sampleNote.indexOf("充足") >= 0 ? ' <span class="tag green">样本足</span>' : "";
        return "<tr><td>" + esc(m.model) + gradeTag + "</td><td>" + sc + "</td><td>" + m.sessions + "</td>" +
          "<td>" + (m.tokensPerTurn != null ? fmt(m.tokensPerTurn) : "—") + "</td>" +
          "<td>" + (m.errorRate * 100).toFixed(1) + "%</td>" +
          "<td>" + (m.avgOutcome != null ? m.avgOutcome : "—") + "</td></tr>";
      }).join("") + "</tbody></table>" +
      '<p class="muted" style="font-size:11px;margin-top:6px">效率30%+质量45%+稳定25%; 样本少的模型结论参考性有限。公平对比请在同一项目跑同类任务。</p>';
  }).catch(function(){});
}`;
s = s.replace(anchor, newTail);

writeFileSync(p, s);
console.log("模型评估UI OK");
