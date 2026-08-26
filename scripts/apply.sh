#!/usr/bin/env bash
# apply.sh —— 变更命令，默认 dry-run，人工确认后才真正执行。
# 本脚本只做"移动/启用/禁用技能"这类仓库内变更，绝不自动改
# settings.json / tool-gate.json / trust.json。
#
# 用法:
#   ./scripts/apply.sh --dry-run move <skill> <target-dir>   # 只看将做什么
#   ./scripts/apply.sh move <skill> <target-dir>              # 确认后执行
#   ./scripts/apply.sh --dry-run disable <skill>
#
# 支持的变更:
#   move <skill> <target-dir>   把某个技能目录移动到目标目录（如迁入 skills/）
#   enable <skill>             将候选技能标记为 active（更新 INDEX/DECISIONS）
#   disable <skill>            将技能标记为 duplicate-of / superseded（更新文档）

set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DRY_RUN=0
[ "${1:-}" = "--dry-run" ] && { DRY_RUN=1; shift; }

cmd="${1:-}"; shift || true
[ -z "$cmd" ] && { echo "用法: $0 [--dry-run] <move|enable|disable> ..."; exit 1; }

confirm() {
  if [ "$DRY_RUN" = "1" ]; then
    echo "[dry-run] 将执行: $*"
    return 0
  fi
  read -r -p "确认执行 [y/N]? " ans
  [ "$ans" = "y" ] || [ "$ans" = "Y" ] || { echo "已取消"; return 1; }
}

case "$cmd" in
  move)
    skill="${1:-}"; target="${2:-}"
    [ -z "$skill" ] || [ -z "$target" ] && { echo "用法: move <skill> <target-dir>"; exit 1; }
    src="$ROOT/skills/$skill"
    [ -d "$src" ] || src="$HOME/.agents/skills/$skill"
    [ -d "$src" ] || { echo "未找到技能: $skill"; exit 1; }
    confirm "cp -r $src $target/"
    [ "$DRY_RUN" = "1" ] && exit 0
    mkdir -p "$target"
    cp -r "$src" "$target/"
    echo "已复制 $skill -> $target/"
    echo "提示: 若为全局技能，删除原目录并确认加载顺序见 docs/INDEX.md"
    ;;
  enable)
    skill="${1:-}"
    [ -z "$skill" ] && { echo "用法: enable <skill>"; exit 1; }
    confirm "更新 docs/DECISIONS.md + docs/INDEX.md: $skill -> active"
    [ "$DRY_RUN" = "1" ] && exit 0
    # 简易标记：在 DECISIONS.md 追加一行
    { echo "- [$(date '+%Y-%m-%d')] \`$skill\` 标记为 active"; } >> "$ROOT/docs/DECISIONS.md"
    echo "已标记 $skill 为 active"
    ;;
  disable)
    skill="${1:-}"; reason="${2:-duplicate/superseded}"
    [ -z "$skill" ] && { echo "用法: disable <skill> [reason]"; exit 1; }
    confirm "更新 docs/DECISIONS.md: $skill -> $reason"
    [ "$DRY_RUN" = "1" ] && exit 0
    { echo "- [$(date '+%Y-%m-%d')] \`$skill\` $reason"; } >> "$ROOT/docs/DECISIONS.md"
    echo "已记录 $skill: $reason"
    ;;
  *)
    echo "未知命令: $cmd"; exit 1
    ;;
esac
