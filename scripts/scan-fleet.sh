#!/usr/bin/env bash
# scan-fleet.sh —— 只读汇总多机 Inventory（ssh），聚合成全局视图。
# 前提: 本机能 ssh 到各目标机，且各目标机已安装本仓库并跑过 scan.sh。
# 本脚本只读：拉取各机 docs/STATUS-<host>.md，不向远程写入任何内容。
#
# 用法:
#   ./scripts/scan-fleet.sh host1 host2 host3
#   ./scripts/scan-fleet.sh --ssh-key ~/.ssh/id_ed25519 host1 host2
#   ./scripts/scan-fleet.sh --remote-dir ~/harness-manager host1 host2

set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REMOTE_DIR="~/harness-manager"
SSH_KEY=""
HOSTS=()

while [ $# -gt 0 ]; do
  case "$1" in
    --remote-dir) REMOTE_DIR="$2"; shift 2 ;;
    --ssh-key) SSH_KEY="$2"; shift 2 ;;
    *) HOSTS+=("$1"); shift ;;
  esac
done

[ ${#HOSTS[@]} -eq 0 ] && { echo "用法: $0 [--ssh-key K] [--remote-dir D] host1 host2 ..."; exit 1; }

SSH_ARGS=()
[ -n "$SSH_KEY" ] && SSH_ARGS+=(-i "$SSH_KEY")

OUT="$ROOT/docs/FLEET-$(date '+%Y%m%d').md"
{
  echo "# Fleet 汇总 —— $(date '+%Y-%m-%d %H:%M:%S')"
  echo
  echo "目标机: ${HOSTS[*]}"
  echo
  for h in "${HOSTS[@]}"; do
    echo "## $h"
    echo "\`\`\`"
    if ssh "${SSH_ARGS[@]}" -o ConnectTimeout=10 -o BatchMode=yes "$h" \
        "cat $REMOTE_DIR/docs/STATUS-*.md 2>/dev/null || echo '(该机未生成快照，请先跑 scan.sh)'"; then
      :
    else
      echo "(ssh 失败: $h)"
    fi
    echo "\`\`\`"
  done
} > "$OUT"

echo "fleet 汇总已写入: $OUT"
echo
head -50 "$OUT"
