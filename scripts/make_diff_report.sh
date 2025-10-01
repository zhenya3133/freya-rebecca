#!/usr/bin/env bash
set -euo pipefail
git fetch origin main >/dev/null 2>&1 || true
BASE="$(git merge-base HEAD origin/main)"
STAMP="$(date +%Y%m%d-%H%M)"
OUT="diff_report/$STAMP"
mkdir -p "$OUT"
git status -sb > "$OUT/00_status.txt"
git diff --find-renames --find-copies --name-status "$BASE"..HEAD > "$OUT/01_name-status.txt"
git diff --stat "$BASE"..HEAD                                  > "$OUT/02_stat.txt"
git diff --dirstat=files,0 "$BASE"..HEAD                        > "$OUT/03_dirstat.txt"
git log --oneline --decorate "$BASE"..HEAD                      > "$OUT/04_log_oneline.txt"
git shortlog --no-merges --summary --numbered "$BASE"..HEAD     > "$OUT/05_shortlog.txt"
git diff --find-renames --find-copies "$BASE"..HEAD             > "$OUT/full.diff"
git format-patch "$BASE"..HEAD -o "$OUT/patchset" >/dev/null
git diff --name-only "$BASE"..HEAD                              > "$OUT/changed_files.txt"
tar -czf "$OUT/changed_files.tar.gz" --files-from "$OUT/changed_files.txt"
echo "[diff] report: $OUT"
