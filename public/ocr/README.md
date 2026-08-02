# Screenshot reader engine

The three binaries here are the OCR engine behind Squad Builder's "Import from
screenshot". They are served from this site rather than a CDN so the feature
works behind corporate filters, keeps working offline once fetched, and sends
nothing about a reader's squad to a third party. They are excluded from the
service worker's precache (see `vite.config.ts`) and fetched only when someone
opens the importer.

| File | From | Why this one |
| --- | --- | --- |
| `worker.min.js` | `tesseract.js@7.0.0` — `dist/worker.min.js` | the Web Worker shell |
| `tesseract-core-lstm.wasm.js` | `tesseract.js-core@7.0.0` | LSTM-only, no SIMD: one binary that runs everywhere. The SIMD builds measured 927ms against 1019ms over thirty word-sized crops, which is not worth hosting three of them and hoping the browser picks one we shipped. |
| `eng.traineddata.gz` | `@tesseract.js-data/eng@1.0.0` — `4.0.0_best_int/` | the int8-quantised "best" model: 2.9MB against 10.9MB for the float one, and more accurate than "fast" |

To refresh, bump the packages and copy the same three files. `src/lib/squadShot.ts`
pins the core by filename, so a rename there needs a change here.

tesseract.js, tesseract.js-core and the trained data are Apache-2.0; the licence
is alongside as `LICENSE-Apache-2.0.txt`.
