# API Contract RC-v1 (кратко)

## POST /api/retrieve
Request:
{
  "q": "string",
  "ns": "string",
  "slot": "staging|prod",
  "nsMode": "prefix|exact",
  "topK": number,
  "candidateK": number,
  "minSimilarity": number,
  "domainFilter": { "allow"?: string[], "deny"?: string[] }
}

Response:
{
  "items": [{
    "url": "string", "title": "string|null", "content": "string",
    "score": number, "ns": "string", "slot": "staging|prod"
  }],
  "debugVersion": "rc-v1",
  "filterInfo"?: any
}

## POST /api/ingest/url
{ "ns":"...", "slot":"staging|prod", "urls":["https://..."], "chunk":{"chars":1200,"overlap":150} }

## POST /api/ingest/pdf
{ "ns":"...", "slot":"staging|prod", "url":"https://...|file://..." }

## POST /api/ingest/github
{ "ns":"...", "slot":"staging|prod", "owner":"...", "repo":"...", "ref":"main", "includeExt":[".md"], "limit":10 }
