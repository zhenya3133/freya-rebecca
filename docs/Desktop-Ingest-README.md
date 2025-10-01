# Desktop Ingest (Windows↔WSL) — Watcher + OCR + Seed + Backfill

## 0) Требования
- WSL Ubuntu с доступом к `sudo`
- Node/Next сервер (`npm run dev`) поднят в `apps/web`
- Установить инструменты:
  ```bash
  sudo apt-get update
  sudo apt-get install -y inotify-tools ocrmypdf tesseract-ocr tesseract-ocr-rus poppler-utils jq pandoc catdoc
