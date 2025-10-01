#!/usr/bin/env bash
# watches a Windows folder and triggers Desktop ingest pipeline with debounce
set -euo pipefail

: "${NS:?need NS}"
: "${X_ADMIN_KEY:?need X_ADMIN_KEY}"
: "${BASE:=http://localhost:3000}"
: "${SLOT:=staging}"

# Resolve base dir
if [ -n "${WINDOWS_INGEST_DIR:-}" ]; then
  BASE_DIR="$WINDOWS_INGEST_DIR"
else
  WIN_DESKTOP=$(wslpath "$(powershell.exe -NoProfile -Command "[Environment]::GetFolderPath('Desktop')" | tr -d '\r')")
  BASE_DIR="${WIN_DESKTOP}/Rebecca_Ingest"
fi
IN_DIR="${BASE_DIR}/in"
OUT_DIR="${BASE_DIR}/out"
mkdir -p "$IN_DIR" "$OUT_DIR"

echo "[watcher] NS=$NS SLOT=$SLOT BASE=$BASE"
echo "[watcher] BASE_DIR=$BASE_DIR"
echo "[watcher] IN_DIR=$IN_DIR"

need() { command -v "$1" >/dev/null 2>&1 || { echo "[error] need $1"; exit 1; }; }
debounce() { local ms="${1:-1500}"; perl -e "select(undef,undef,undef,$ms/1000)" 2>/dev/null || sleep 2; }
run_ingest() {
  echo "[watcher] change detected → debounce…"; debounce 1500
  echo "[watcher] launching ingest_from_desktop.sh"
  WINDOWS_INGEST_DIR="${BASE_DIR}" \
  NS="$NS" SLOT="$SLOT" X_ADMIN_KEY="$X_ADMIN_KEY" BASE="$BASE" \
    bash ./apps/web/scripts/ingest_from_desktop.sh || echo "[warn] ingest exited non-zero"
  echo "[watcher] ingest cycle finished."
}

# Detect if path is on Windows drive (/mnt/<letter>/...)
if [[ "$IN_DIR" =~ ^/mnt/[a-zA-Z]/ ]]; then
  MODE="poll"
else
  MODE="inotify"
fi

if [ "$MODE" = "inotify" ]; then
  # WSL ext4 → inotify ok
  has_inotify=0; command -v inotifywait >/dev/null 2>&1 && has_inotify=1 || true
  if [ $has_inotify -eq 0 ]; then
    echo "[error] need inotify-tools on ext4 paths: sudo apt-get install -y inotify-tools"; exit 1
  fi
  echo "[watcher] mode=inotify (recursive) on: $IN_DIR"
  inotifywait -m -r -e create -e close_write -e moved_to --format '%w%f' "$IN_DIR" | \
  while read -r changed; do
    case "${changed,,}" in *.pdf|*.doc|*.docx) run_ingest ;; esac
  done
else
  # Windows drive (/mnt/*) → poll every 3s
  echo "[watcher] mode=poll (Windows drive) on: $IN_DIR"
  INTERVAL="${INTERVAL:-3}"         # seconds
  LAST_HASH=""
  while true; do
    # список файлов с mtime+size, чтобы отслеживать изменения
    SNAPSHOT=$(find "$IN_DIR" -maxdepth 1 -type f \( -iname '*.pdf' -o -iname '*.doc' -o -iname '*.docx' \) \
      -printf '%p|%TY-%Tm-%Td %TH:%TM:%TS|%s\n' 2>/dev/null | sort)
    HASH=$(printf '%s' "$SNAPSHOT" | sha1sum | awk '{print $1}')
    if [ -n "$SNAPSHOT" ] && [ "$HASH" != "$LAST_HASH" ]; then
      run_ingest
      LAST_HASH="$HASH"
    fi
    sleep "$INTERVAL"
  done
fi
