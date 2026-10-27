#!/usr/bin/env bash
# Limpieza del vigilante. Modos:
#   contar              -> "huerfanos=<n> tmp_mb=<n>"
#   listar              -> lo que limpiaría (no toca nada)
#   limpiar             -> lo hace
#   fin <claude_pid>    -> mata los brokers de Codex de esa sesión de Claude (al salir)
#
# Huérfano = broker de Codex (app-server-broker.mjs) cuyo CLAUDE_PID ya no existe.
# Scratchpad abandonado = /tmp/claude-$UID/<proyecto>/<sesión>/ cuya transcripción
# lleva más de DIAS días sin tocarse. Los worktrees con cambios sin commitear se
# dejan en paz y se avisan.
set -u
DIAS=${VIGILANTE_DIAS:-2}
TMP_BASE="/tmp/claude-$(id -u)"
PROYECTOS="$HOME/.claude/projects"
SESION_ACTUAL=${VIGILANTE_SESION:-}

brokers() { pgrep -f 'app-server-broker.mjs serve' 2>/dev/null; }

claude_pid_de() { tr '\0' '\n' < "/proc/$1/environ" 2>/dev/null | sed -n 's/^CLAUDE_PID=//p'; }

descendientes() { # pid -> pid y todos sus descendientes
  local p=$1 h
  echo "$p"
  for h in $(pgrep -P "$p" 2>/dev/null); do descendientes "$h"; done
}

huerfanos() {
  local b cp
  for b in $(brokers); do
    cp=$(claude_pid_de "$b")
    [ -n "$cp" ] && ! kill -0 "$cp" 2>/dev/null && echo "$b"
  done
}

scratch_abandonados() { # imprime directorios de sesión abandonados
  local d sid slug t
  [ -d "$TMP_BASE" ] || return 0
  for d in "$TMP_BASE"/*/*/; do
    d=${d%/}
    sid=$(basename "$d"); slug=$(basename "$(dirname "$d")")
    [[ $sid =~ ^[0-9a-f-]{36}$ ]] || continue
    [ "$sid" = "$SESION_ACTUAL" ] && continue
    t="$PROYECTOS/$slug/$sid.jsonl"
    if [ -e "$t" ]; then
      [ -n "$(find "$t" -mtime -"$DIAS" 2>/dev/null)" ] && continue
    else
      [ -n "$(find "$d" -maxdepth 0 -mtime -"$DIAS" 2>/dev/null)" ] && continue
    fi
    echo "$d"
  done
}

worktrees_en() { # dir -> worktrees de git dentro
  find "$1" -maxdepth 4 -name .git -type f 2>/dev/null | xargs -r -n1 dirname
}

case "${1:-contar}" in
  contar)
    n=$(huerfanos | wc -l)
    mb=$(du -sm "$TMP_BASE" 2>/dev/null | cut -f1)
    echo "huerfanos=$n tmp_mb=${mb:-0}"
    ;;
  listar|limpiar)
    hacer=0; [ "$1" = limpiar ] && hacer=1
    hs=$(huerfanos)
    echo "## Procesos de Codex huérfanos: $(echo -n "$hs" | grep -c .)"
    for b in $hs; do
      dias=$(( $(ps -o etimes= -p "$b" 2>/dev/null || echo 0) / 86400 ))
      echo "- broker $b (hace ${dias} d)"
      if [ $hacer = 1 ]; then kill $(descendientes "$b" | tac) 2>/dev/null; fi
    done
    echo
    echo "## Scratchpads de sesiones paradas hace más de $DIAS días"
    total=0; sucios=""
    for d in $(scratch_abandonados); do
      mb=$(du -sm "$d" 2>/dev/null | cut -f1); total=$((total + ${mb:-0}))
      saltar=0
      for wt in $(worktrees_en "$d"); do
        if [ -n "$(git -C "$wt" status --porcelain 2>/dev/null)" ]; then
          sucios="$sucios\n- $wt"; saltar=1
        fi
      done
      if [ $saltar = 1 ]; then echo "- $d (${mb} MB) — SE CONSERVA: worktree con cambios"; continue; fi
      echo "- $d (${mb} MB)"
      if [ $hacer = 1 ]; then
        for wt in $(worktrees_en "$d"); do
          main=$(git -C "$wt" rev-parse --git-common-dir 2>/dev/null)
          rm -rf "$wt"
          [ -n "$main" ] && git --git-dir="$main" worktree prune 2>/dev/null
        done
        rm -rf "$d"
      fi
    done
    echo
    echo "Total scratchpads: ${total} MB"
    [ -n "$sucios" ] && printf "\nWorktrees con cambios sin commitear (no se tocan):%b\n" "$sucios"
    [ $hacer = 0 ] && echo && echo "Nada borrado. Para hacerlo: /limpieza ya"
    ;;
  fin)
    cp=${2:-}
    [ -n "$cp" ] || exit 0
    for b in $(brokers); do
      [ "$(claude_pid_de "$b")" = "$cp" ] && kill $(descendientes "$b" | tac) 2>/dev/null
    done
    ;;
esac
exit 0
