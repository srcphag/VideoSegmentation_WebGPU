# VideoSegmentation_WebGPU

100% client-side video element segmentation that renders Apple ProRes `.mov` output — no uploads, no backend. Everything (auto-detection, tracking, compositing, encoding) runs in the browser on WebGPU / WASM.

**Live:** https://video-segmentation-webgpu.netlify.app

## Features

- **Automatic element discovery** — a uniform grid of points is decoded through SAM 2.1 / EdgeTAM image embeddings, then filtered by IoU, mask stability, area and frame-corner rejection, deduplicated with low-res NMS.
- **Click-to-select** — hover and click detected elements directly on the canvas; selection is mirrored in the left `detected elements` list.
- **Multi-element propagation** — selected elements are tracked across the `In → Out` range using padded bounding boxes plus a 2-pass Chamfer distance-transform interior peak prompt.
- **Live mask refinement** — threshold, choke/expand (erode/dilate) and Gaussian edge feather, applied in real time from cached quantized logits.
- **ProRes export** — `prores-wasm-encoder` writes straight-RGBA **ProRes 4444 / 4444 XQ** with alpha, **B&W luma mattes**, or both.

## Models

| Label | Model ID |
| --- | --- |
| EdgeTAM (mobile SAM 2) | `onnx-community/EdgeTAM-ONNX` |
| SAM 2.1 Tiny | `onnx-community/sam2.1-hiera-tiny-ONNX` |
| SlimSAM 77 | `Xenova/slimsam-77-uniform` |
| SAM 2.1 Small (precise) | `onnx-community/sam2.1-hiera-small-ONNX` |
| SAM 2.1 Base+ (high precision) | `onnx-community/sam2.1-hiera-base-plus-ONNX` |

Weights are downloaded from the Hugging Face Hub on first use and cached by the browser.

## Development

```bash
npm install
npm run dev        # http://localhost:5175
npm run build      # typecheck + production build
npm run test:unit  # vitest (pipeline + real ProRes encode)
```

Useful URL flags:

- `?demo=1` — load a synthetic 320×180 clip with moving elements.
- `?mockAi=1` — skip model download and use deterministic mock masks.

## Deploy

Hosted on Netlify (project `video-segmentation-webgpu`). `netlify.toml` pins the build command, publish directory, and asset caching.

```bash
netlify deploy --build --prod
```

## Stack

Vite · Vanilla TypeScript · `@huggingface/transformers` (WebGPU) · `prores-wasm-encoder` · `letieu/terminal.css`

UI follows the 3-column dark studio layout used by [TextureMosaic](https://github.com/srcphag/TextureMosaic).

## Specifications

Design and requirements docs live in [`specification/`](specification/): `requirements.md`, `techPlan.md`, `developmentPlan.md`, `uiPrototype.md`.
