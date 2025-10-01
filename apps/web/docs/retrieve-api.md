# /api/retrieve — мини-README

**Метод:** `POST`

## Тело запроса
```json
{
  "q": "строка запроса",
  "ns": "rebecca/army/refs",
  "topK": 10,
  "domainFilter": { "allow": ["developer.mozilla.org"], "deny": ["wikipedia.org"] },
  "debug": true
}


