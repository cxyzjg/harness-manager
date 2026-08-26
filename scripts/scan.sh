#!/usr/bin/env bash
# scan.sh —— 只读盘点本机 harness 资源，生成 Inventory 快照 + 候选重复报告。
# 不修改任何配置（不改 settings / tool-gate / trust）。
#
# 用法:
#   ./scripts/scan.sh                 # 扫描并生成 docs/STATUS-<host>.md
#   ./scripts/scan.sh --stdout        # 只输出到 stdout，不写文件
#
# 扫描范围:
#   - 全局 skills:  ~/.pi/agent/skills, ~/.agents/skills
#   - 项目 skills:  cwd 及祖先目录的 .pi/skills, .agents/skills（到 git root）
#   - 包:           ~/.pi/agent/settings.json 的 packages
#   - 工具 gate:    ~/.pi/agent/config/tool-gate.json
#   - 本仓库自身:   skills/, extensions/（单源）
#   - 信任项目:     ~/.pi/agent/trust.json

set -uo pipefail

HOST="$(hostname 2>/dev/null || echo 'unknown')"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MODE="${1:-file}"
OUT="$ROOT/docs/STATUS-$HOST.md"

# 报告内容写入文件；--stdout 时直接打印
report() {
  {
    echo "# Inventory — $HOST"
    echo
    echo "_自动生成于 $(date '+%Y-%m-%d %H:%M:%S')。来源: $(basename "$0")_"
    echo
    echo "## 环境"
    printf -- "- hostname: %s\n" "$HOST"
    printf -- "- home: %s\n" "$HOME"
    printf -- "- pi version: %s\n" "$(pi --version 2>/dev/null || echo 'n/a')"
    echo
    echo "## 全局 skills"
    found_global=0
    for d in "$HOME/.pi/agent/skills" "$HOME/.agents/skills"; do
      if [ -d "$d" ]; then
        echo "- **$d**"
        for sk in "$d"/*/SKILL.md; do
          [ -e "$sk" ] || continue
          name="$(basename "$(dirname "$sk")")"
          desc="$(awk -F': ' '/^description:/{print $2; exit}' "$sk" 2>/dev/null || echo '')"
          printf "  - \`%s\` — %s\n" "$name" "${desc:0:90}"
          found_global=$((found_global+1))
        done
      else
        echo "- $d (不存在)"
      fi
    done
    [ "$found_global" -eq 0 ] && echo "  （未发现技能）"

    echo
    echo "## pi 包 (settings.json packages)"
    SETTINGS="$HOME/.pi/agent/settings.json"
    if [ -f "$SETTINGS" ]; then
      if command -v python >/dev/null 2>&1; then
        python - "$SETTINGS" <<'PY'
import json,sys
try:
    s=json.load(open(sys.argv[1]))
except Exception as e:
    print("  解析失败:", e); sys.exit(0)
for p in s.get("packages", []):
    if isinstance(p, dict):
        print(f"  - {p.get('source','?')} (filtered)")
    else:
        print(f"  - {p}")
PY
      else
        grep -oE '"packages"[^]]*\]' "$SETTINGS" | head -20 || echo "  (无法解析)"
      fi
    else
      echo "  (未找到 $SETTINGS)"
    fi

    echo
    echo "## 工具 gate (tool-gate.json)"
    GATE="$HOME/.pi/agent/config/tool-gate.json"
    if [ -f "$GATE" ]; then
      grep -E '"(disabled|disabledGroups|enabledGroups|protected|profiles|projects)"' "$GATE" | head -20
    else
      echo "  (未找到 $GATE)"
    fi

    echo
    echo "## 信任项目 (trust.json)"
    TRUST="$HOME/.pi/agent/trust.json"
    if [ -f "$TRUST" ]; then
      grep -oE '"[^"]+": *true' "$TRUST" | sed 's/: *true//' | sed 's/^/  - /'
    else
      echo "  (未找到 $TRUST)"
    fi

    echo
    echo "## 本仓库资源 (单源)"
    for sk in "$ROOT"/skills/*/SKILL.md; do
      [ -e "$sk" ] || continue
      printf "  - skill \`%s\`\n" "$(basename "$(dirname "$sk")")"
    done
    for ext in "$ROOT"/extensions/*; do
      [ -e "$ext" ] || continue
      printf "  - extension \`%s\`\n" "$(basename "$ext")"
    done

    echo
    echo "## 候选重复"
    # 1) 同名（跨目录）
    declare -A seen
    for d in "$HOME/.pi/agent/skills" "$HOME/.agents/skills" "$ROOT/skills"; do
      [ -d "$d" ] || continue
      for sk in "$d"/*/SKILL.md; do
        [ -e "$sk" ] || continue
        name="$(basename "$(dirname "$sk")")"
        if [ -n "${seen[$name]:-}" ]; then
          echo "  - [同名] \`$name\` 出现于: ${seen[$name]} 和 $d"
        else
          seen[$name]="$d"
        fi
      done
    done
    # 2) 功能重叠（按描述关键词聚类）——只输出同时命中多目录的桶
    #    关键词 => 常见技能描述用词，用于发现候选，需人工确认。
    declare -A overlap
    OVERLAP_KEYS=("review" "debug" "plan" "scaffold" "spec" "test" "write" "clean" "security" "architecture")
    for key in "${OVERLAP_KEYS[@]}"; do
      bucket=()
      for d in "$HOME/.agents/skills" "$ROOT/skills" "$HOME/.pi/agent/skills"; do
        [ -d "$d" ] || continue
        for sk in "$d"/*/SKILL.md; do
          [ -e "$sk" ] || continue
          desc="$(awk -F': ' '/^description:/{print $2; exit}' "$sk" 2>/dev/null || echo '')"
          if echo "$desc" | grep -qiE "${key}s?\b"; then
            bucket+=("$(basename "$(dirname "$sk")")")
          fi
        done
      done
      # 只报告命中超过 1 个来源的桶（跨来源才叫重复候选）
      if [ "${#bucket[@]}" -gt 1 ]; then
        uniq_bucket=($(printf '%s\n' "${bucket[@]}" | sort -u))
        echo "  - [功能重叠:$key] ${uniq_bucket[*]}"
      fi
    done
  } > "$OUT"
  echo "快照已写入: $OUT"
  echo
  cat "$OUT"
}

if [ "$MODE" = "--stdout" ]; then
  OUT="/dev/stdout"
fi
mkdir -p "$(dirname "$OUT")"
report
