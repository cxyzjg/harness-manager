/**
 * 技能语义去重 (阶段4收尾①) — 本地语义近似, 无外部API(隐私边界D4)
 *
 * 中文短文案的字符bigram区分度差("bug排查"vs"调试"零重叠),
 * 故采用三层信号:
 *   S1 名称结构相似: token Jaccard + bigram Dice
 *   S2 实词语义重叠: 中英分词后 Jaccard + 同义词簇命中
 *   S3 同义词典:     领域近义簇(debug/审查/测试/计划/脚手架/交接...)计数
 */
import { allSkillInfos, type SkillInfo } from "../../analysis/skillDescriptions.js";

export interface SemanticPair {
  a: string;
  b: string;
  score: number;
  verdict: "semantic-duplicate" | "overlap";
  signals: string[];
}

/** 近义簇: 同簇内的词视为同一概念 */
const SYN_CLUSTERS: string[][] = [
  ["debug", "debugging", "调试", "排查", "诊断", "bug", "根因"],
  ["review", "审查", "评审"],
  ["test", "测试", "tdd", "驱动", "红绿"],
  ["plan", "计划", "规划", "路线图", "地图", "buildplan"],
  ["spec", "规格", "需求", "问卷", "澄清", "拷问", "访谈"],
  ["scaffold", "脚手架", "骨架", "生成项目"],
  ["security", "安全", "审计", "漏洞"],
  ["deploy", "部署", "发布", "staging", "回滚"],
  ["handoff", "交接", "续接", "resume", "restart", "恢复"],
  ["token", "成本", "用量", "cost"],
  ["memory", "记忆", "上下文"],
  ["implement", "实现", "编码", "开发"],
  ["架构", "architecture", "模块", "domain", "领域", "建模"],
  ["写作", "writing", "文档", "文档化"],
  ["任务", "工单", "ticket", "triage", "分诊"],
];

function tokens(text: string): Set<string> {
  const t = text.toLowerCase();
  const out = new Set<string>();
  // 英文词
  for (const m of t.matchAll(/[a-z][a-z0-9_-]{1,}/g)) out.add(m[0].replace(/[_-]/g, ""));
  // 中文2-gram(捕获词组)
  const zh = t.replace(/[^一-鿿]/g, "");
  for (let i = 0; i < zh.length - 1; i++) out.add(zh.slice(i, i + 2));
  return out;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

/** 同义词簇命中数: 两文本共同命中的簇数/总簇 */
function clusterHits(a: string, b: string): { hits: string[]; scoreA: number; scoreB: number } {
  const hits: string[] = [];
  let ca = 0;
  let cb = 0;
  for (const cluster of SYN_CLUSTERS) {
    const inA = cluster.some((w) => a.toLowerCase().includes(w));
    const inB = cluster.some((w) => b.toLowerCase().includes(w));
    if (inA) ca++;
    if (inB) cb++;
    if (inA && inB) hits.push(cluster[0]);
  }
  return { hits, scoreA: ca, scoreB: cb };
}

export function pairSimilarity(a: SkillInfo, b: SkillInfo): SemanticPair | null {
  const bodyA = `${a.name} ${a.what} ${a.when} ${a.outcome}`;
  const bodyB = `${b.name} ${b.what} ${b.when} ${b.outcome}`;

  const tokSim = jaccard(tokens(a.name), tokens(b.name)); // S1
  const wordSim = jaccard(tokens(bodyA), tokens(bodyB)); // S2
  const clu = clusterHits(bodyA, bodyB); // S3

  // 同簇集中度: 双方各自的命中簇里有多少是共同的
  const clusterConc = Math.min(clu.scoreA, clu.scoreB) > 0 ? clu.hits.length / Math.min(clu.scoreA, clu.scoreB) : 0;

  const sameCat = a.category === b.category ? 0.08 : -0.08;
  // 名称包含关系(grilling ⊂ grill-with-docs)是强信号
  const nameInclusion = a.name.includes(b.name) || b.name.includes(a.name) ? 0.12 : 0;
  const sharedPrefix = a.name.split("-")[0] === b.name.split("-")[0] && a.name.split("-")[0].length > 3 ? 0.06 : 0;
  const score = +(tokSim * 0.3 + wordSim * 0.35 + clusterConc * 0.45 + sameCat + nameInclusion + sharedPrefix).toFixed(3);

  if (score < 0.5 || !clu.hits.length) return null; // 无共同概念簇直接排除

  const verdict: SemanticPair["verdict"] = score >= 0.64 ? "semantic-duplicate" : "overlap";
  const signals = [`共通概念: ${clu.hits.join("/")}`, `token ${(tokSim * 100) | 0}%`, `词汇 ${(wordSim * 100) | 0}%`];
  return { a: a.name, b: b.name, score, verdict, signals };
}

export function semanticDedupe(names?: string[]): SemanticPair[] {
  let infos = allSkillInfos();
  if (names?.length) {
    const set = new Set(names);
    infos = infos.filter((i) => set.has(i.name));
  }
  const out: SemanticPair[] = [];
  for (let i = 0; i < infos.length; i++) {
    for (let j = i + 1; j < infos.length; j++) {
      const p = pairSimilarity(infos[i], infos[j]);
      if (p) out.push(p);
    }
  }
  return out.sort((x, y) => y.score - x.score);
}
