# Local Translation Benchmark

Run against a `llama-server` OpenAI endpoint:

```sh
node benchmarks/run-translation.js http://127.0.0.1:38296/v1 4b-q4 /tmp/4b.json
```

The 30 cases in `translation-cases.json` cover English/Vietnamese business
meaning, pronouns, omitted subjects, group ambiguity, media context, OCR noise,
idioms, cultural terms, mixed language, numbers, and identifiers.

## 2026-07-06 Result

Both models used llama.cpp `b9867`, Metal, a 2,048-token context, temperature
zero, and ZaDark's production chat template on a 32 GB Apple Silicon Mac.

| Model | Disk | Resident memory | Median | p95 | Exact identifiers |
| --- | ---: | ---: | ---: | ---: | ---: |
| TranslateGemma 4B Q4_K_S | 2.38 GB | 0.69 GB | 732 ms | 1,373 ms | 9/10 |
| TranslateGemma 12B Q4_K_M | 7.30 GB | 6.07 GB | 2,312 ms | 4,608 ms | 10/10 |

Manual adequacy scoring used `0` for materially wrong, `1` for usable with a
meaningful defect, and `2` for correct/natural enough for chat. One evaluator
scored the outputs against each case's `focus` field:

- 4B: 33/60
- 12B: 50/60
- 12B won 12 cases, 4B won 2, and 16 tied.

The 12B model fixed the most dangerous failures: payment direction, a completed
action translated as a question, context copied instead of the selected
message, image-message subject reversal, reply reference, and Tet dates. Both
models missed sarcasm, and some ambiguous group pronouns remain inherently
unresolvable.

This is a product benchmark, not a published language benchmark. Before a
release changes defaults broadly, another Vietnamese speaker should
blind-review the saved outputs.
