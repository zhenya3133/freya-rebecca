## Summary
- G6 migration: `chunks.embedding` set to **NULLABLE**.
- Robust fetch with retries/UA in `/api/ingest/url` and `/api/ingest/github`.
- `/api/retrieve` aligned to **RC-v1**: `items[]` (url,title,content,score) + `filterInfo` + `debugVersion`.
- Added `apps/web/Dockerfile`, minor infra tweaks.

## Evidence

**db-ping**
```json
{
  "ok": true,
  "now": "2025-09-25T11:37:21.543Z"
}
```

**ingest/url**
```json
{
  "ok": true,
  "ns": "rebecca/army/refs",
  "slot": "staging",
  "urls": [
    "https://www.rfc-editor.org/rfc/rfc9110",
    "https://httpbin.org/html"
  ],
  "pdfDelegated": 0,
  "pdfStats": {
    "chunks": 0,
    "written": 0
  },
  "textChunks": 447,
  "textInserted": 0,
  "textUpdated": 0,
  "failures": [],
  "ms": 29697
}
```

**ingest/pdf**
```json
{
  "ok": true,
  "ns": "rebecca/army/refs",
  "slot": "staging",
  "url": "https://arxiv.org/pdf/2402.19472.pdf",
  "pages": null,
  "chunks": 104,
  "ms": 14401
}
```

**ingest/github**
```json
{
  "ok": true,
  "ns": "rebecca/army/refs",
  "slot": "staging",
  "owner": "openai",
  "repo": "openai-cookbook",
  "ref": "main",
  "totalFiles": 57,
  "windowStart": 0,
  "windowEnd": 9,
  "pageFiles": 10,
  "chunks": 45,
  "written": [],
  "nextCursor": 10,
  "ms": 11031
}
```

**retrieve (full)**
```json
{
  "items": [
    {
      "id": "3f6d1628-86cf-4ab2-9e41-6856f427f93f",
      "url": "https://www.rfc-editor.org/rfc/rfc9110",
      "title": null,
      "content": "= month SP ( 2DIGIT / ( SP DIGIT ) ) day = 2DIGIT day-name = %x4D.6F.6E ; Mon / %x54.75.65 ; Tue / %x57.65.64 ; Wed / %x54.68.75 ; Thu / %x46.72.69 ; Fri / %x53.61.74 ; Sat / %x53.75.6E ; Sun day-name-l = %x4D.6F.6E.64.61.79 ; Monday / %x54.75.65.73.64.61.79 ; Tuesday / %x57.65.64.6E.65.73.64.61.79 ; Wednesday / %x54.68.75.72.73.64.61.79 ; Thursday / %x46.72.69.64.61.79 ; Friday / %x53.61.74.75.72.64.61.79 ; Saturday / %x53.75.6E.64.61.79 ; Sunday delay-seconds = 1*DIGIT entity-tag = [ weak ] opaque-tag etagc = \"!\" / %x23-7E ; '#'-'~' / obs-text expectation = token [ \"=\" ( token / quoted-string ) parameters ] field-content = field-vchar [ 1*( SP / HTAB / field-vchar ) field-vchar ] field-name = token field-value = *field-content field-vchar = VCHAR / obs-text first-pos = 1*DIGIT hour = 2DIGIT http-URI = \"http://\" authority path-abempty [ \"?\" query ] https-URI = \"https://\" authority path-abempty [ \"?\" query ] incl-range = first-pos \"-\" last-pos int-range = first-pos \"-\" [ last-pos ] language-range = &lt;language-range, see [RFC4647], Section 2.1&gt; language-tag = &lt;Language-Tag, see [RFC5646], Section 2.1&gt; last-pos = 1*DIGIT mailbox = &lt;mailbox, see [RFC5322], Section 3.4&g",
      "score": 0.2869053699785045
    },
    {
      "id": "dad7e002-eb21-4640-8941-1d6b22b4fdfb",
      "url": "https://arxiv.org/pdf/2402.19472.pdf",
      "title": null,
      "content": "sert M ( 2 ) within our framework. We comprehensively draw connections across different research directions in Appendix G and briefly present the most similar works here. Model Spider [ 105 ] efficiently ranks models from a pre-trained model zoo. LOVM [ 110 ], Flash-Eval [ 106 ] and Flash-HELM [ 67 ] similarly rank foundation models efficiently on unseen datasets. However, these approaches predict dataset-level metrics rather than instance-level metrics, and thereby cannot be used in our setup to grow the prediction cache efficiently (see Section 2.1). Concurrent to our work, Anchor Point Sampling [ 91 ] and IRT-Clustering [ 69 ] both propose efficient instance-level evaluations by creating smaller core-sets from test data. They introduce clustering-based approaches and item response theory [ 4] to obtain sample-wise accuracy predictions. However, their methods require memory and time complexity quadratic in the number of data samples, i.e., O(|D| 2) requiring well over 10TB of RAM for benchmarks having a million samples. The comparisons are infeasible to scale on datasets bigger than a few thousand samples. In contrast, our novel Sort & Search approach, requires memory and time co",
      "score": 0.27465805938993865
    },
    {
      "id": "68af4905-d567-422d-8f0b-0b48cf1a3bab",
      "url": "https://www.rfc-editor.org/rfc/rfc9110",
      "title": null,
      "content": "uest separately, retain a revision control history, or implement other non-idempotent side effects for each idempotent request. ¶ Idempotent methods are distinguished because the request can be repeated automatically if a communication failure occurs before the client is able to read the server's response. For example, if a client sends a PUT request and the underlying connection is closed before any response is received, then the client can establish a new connection and retry the idempotent request. It knows that repeating the request will have the same intended effect, even if the original request succeeded, though the response might differ. ¶ A client SHOULD NOT automatically retry a request with a non-idempotent method unless it has some means to know that the request semantics are actually idempotent, regardless of the method, or some means to detect that the original request was never applied. ¶ For example, a user agent can repeat a POST request automatically if it knows (through design or configuration) that the request is safe for that resource. Likewise, a user agent designed specifically to operate on a version control repository might be able to recover from partial fa",
      "score": 0.2718477804246224
    },
    {
      "id": "547efea3-6532-4a7a-a4b4-9c6b47e2be97",
      "url": "https://arxiv.org/pdf/2402.19472.pdf",
      "title": null,
      "content": "ndom sampling approach in Section 4. \n\nSubtask 2: Optimizing ym+1 . Given the n′ observations a′ \n\n> m+1\n\n∈ { 0, 1}1×n′\n\n, how to generate the prediction vector ym+1 ∈ { 0, 1}1×n? We use the threshold given by DP-Search (Listing 1) and obtain the threshold, given in terms of fraction of samples in |a′\n\n> m+1\n\n|. We extrapolate this threshold from \n\nn′ to n points, to obtain the threshold for the prediction vector ym+1 . ym+1 is simply [1⊤ \n\n> k\n\n, 0⊤\n\n> n−k\n\n]\n\nwhere 1k is a vector of all ones of size k and 0n−k is a zero vector of size n − k.So far, we have only discussed evaluation of ∆m new models ( 2 insert M). How can we also efficiently extend the benchmark i.e. efficiently adding ∆n new samples ( 1 insert D )? \n\n3.3 Efficient Insertion of New Samples ( insert D )\n\nTo add new samples into our lifelong benchmark efficiently, we have to estimate their difficulty with respect to the other samples in the cache A. To efficiently determine difficulty by only evaluating \n\nm′ ≪ m models, a ranking over models is required to enable optimally sub-sampling a subset of m′\n\nmodels. This problem is quite similar in structure to the previously discussed addition of new models, where we had",
      "score": 0.26408371990420404
    },
    {
      "id": "c8566fc8-0849-4218-bf2e-2a51fd530b02",
      "url": "https://arxiv.org/pdf/2402.19472.pdf",
      "title": null,
      "content": "we note an MAE degradation when using the continual relaxation of the accuracy prediction values as confidence values, signifying no benefits. However, using the multi-step recursive correction of rankings ( 3 ) provides significant boosts (0.5% boost in MAE at all n′>1, 024 ) due to its ability to locally correct ranking errors that the global sum method ( 1 ) is unable to account for. \n\nDifferent Sampling Methods. In Fig. 4(d), we compare methods used for sub-selecting the data-samples to evaluate—we compare uniform vs. random sampling. Both methods converge very quickly and at similar budgets to their optimal values and start plateauing. However, uniform sampling provides large boosts over random sampling when the sampling budget is small (5% lower MAE at n′=8 )—this can be attributed to its “diversity-seeking” behaviour which helps cover samples from all difficulty ranges, better representing the entire benchmark evaluation samples rather than an unrepresentative random set sampled via random sampling. \n\n> 5\n\nRecursive sum ( 3 ) is not applicable here as all sum values are unique, see Section 3.3. \n\n910 1 10 2 10 3     \n\n> Sampling Budget m'\n> 0.150\n> 0.175\n> 0.200\n> 0.225\n> 0",
      "score": 0.25675109097348686
    }
  ],
  "filterInfo": {
    "allowMatched": 200,
    "denySkipped": 0
  },
  "debugVersion": "rc-v1"
}
```

**retrieve (compact)**
```json
{
  "items": [
    {
      "score": 0.2869053699785045,
      "title": null,
      "url": "https://www.rfc-editor.org/rfc/rfc9110"
    },
    {
      "score": 0.27465805938993865,
      "title": null,
      "url": "https://arxiv.org/pdf/2402.19472.pdf"
    },
    {
      "score": 0.2718477804246224,
      "title": null,
      "url": "https://www.rfc-editor.org/rfc/rfc9110"
    },
    {
      "score": 0.26408371990420404,
      "title": null,
      "url": "https://arxiv.org/pdf/2402.19472.pdf"
    },
    {
      "score": 0.25675109097348686,
      "title": null,
      "url": "https://arxiv.org/pdf/2402.19472.pdf"
    }
  ],
  "filterInfo": {
    "allowMatched": 200,
    "denySkipped": 0
  },
  "debugVersion": "rc-v1"
}
```

## Diff summary
```
b9b57b0 feat: Implement /api/retrieve endpoint compliance and robustness features
```

```
 apps/web/Dockerfile                                |  9 ++++
 apps/web/retrieve_grep_output.txt                  |  9 ++++
 .../migrations/G6_make_embedding_nullable.sql      |  2 +
 apps/web/src/app/api/ingest/github/route.ts        |  3 +-
 apps/web/src/app/api/ingest/pdf/route.ts           |  5 +-
 apps/web/src/app/api/ingest/url/route.ts           |  5 +-
 apps/web/src/lib/ingest_upsert.ts                  | 62 ++++++++++------------
 apps/web/src/lib/retrieval-contract.ts             |  9 ++--
 apps/web/src/lib/retriever_v2.ts                   | 23 +++-----
 apps/web/src/lib/retryFetch.ts                     | 32 +++++++++++
 apps/web/src/lib/sleep.ts                          |  5 ++
 11 files changed, 101 insertions(+), 63 deletions(-)
```

## Notes
- Keep `snapshot-20250924-2302` as an archived branch.
- Stage B next: background embeddings, ranking improvements, SQL upsert, CI (tsc + fresh DB migrations + smoke e2e).
