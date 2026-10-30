# Video Segmentation Web Application — Development Plan (Option A: Auto-Detect & Select)

## 1. Architecture & Tech Stack
- **Build System & UI**: Vite + Vanilla TypeScript + `letieu/terminal.css` (matching `https://github.com/srcphag/TextureMosaic`)
- **AI Engine (Option A: Uniform Grid Prompting + NMS)**:
  - `@huggingface/transformers` running on **WebGPU** in a dedicated Web Worker (`src/workers/samWorker.ts`)
  - **Supported Models**:
    - `onnx-community/EdgeTAM-ONNX` (`EdgeTamModel`)
    - `onnx-community/sam2.1-hiera-tiny-ONNX` (`Sam2Model`)
    - `Xenova/slimsam-77-uniform` (`SamModel`)
    - `onnx-community/sam2.1-hiera-small-ONNX` (`Sam2Model`)
    - `onnx-community/sam2.1-hiera-base-plus-ONNX` (`Sam2Model` — High Precision)
- **Video Encoder**: `prores-wasm-encoder` (`createProResEncoder`, `ProResProfile`, `movToBlob`)
- **Naming Convention**: All folders and files strictly use `camelCase` (`AGENTS.md`).

---

## 2. Project Directory Structure (`camelCase`)

```text
E:\Works\VideoSegmentation
├── AGENTS.md
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
├── specification/
│   ├── requirements.md
│   ├── techPlan.md
│   ├── developmentPlan.md
│   └── uiPrototype.md
├── src/
│   ├── main.ts
│   ├── types/
│   │   └── segmentationTypes.ts     # DetectedElement, FrameMaskEntry, AutoDetectConfig, AppState
│   ├── ui/
│   │   ├── terminal.css             # Base letieu/terminal.css stylesheet
│   │   └── styles.css               # TextureMosaic 3-column studio layout & element list styles
│   ├── components/
│   │   ├── topBar.ts                # Left Inputs panel: Video loader, Model selector, Auto-Detect controls, Elements list
│   │   ├── videoViewport.ts         # Center Stage: Header, dropzone, interactive hit-test canvas
│   │   ├── controlPanel.ts          # Right Parameters panel: Propagate, Preview mode, Edge refinement, ProRes export
│   │   └── timelineBar.ts           # Bottom Center transport: Play/step, In/Out handles, keyframe/tracked scrubber
│   ├── workers/
│   │   └── samWorker.ts             # WebGPU worker: Uniform grid decoding + NMS + multi-element propagation
│   ├── tracking/
│   │   ├── distanceTransform.ts     # 2-pass Chamfer distance transform for interior mask prompt peaks
│   │   ├── gridNms.ts               # Uniform grid generator, low-res mask IoU/containment NMS, composite merger
│   │   └── maskPropagator.ts        # Worker coordinator, element selection state, & frame propagation loop
│   └── rendering/
│       ├── videoFrameManager.ts     # Instantaneous latest-only scrubbing & sequential frame RGBA extraction
│       ├── maskPostProcessor.ts     # Logit threshold, morphological choke/expand, separable Gaussian feather
│       ├── frameCompositor.ts       # Multi-element overlay renderer + straight-RGBA & B&W matte buffer builders
│       └── proresExporter.ts        # ProRes .mov encoding (4444 Alpha & B&W Matte) via prores-wasm-encoder
└── tests/
    └── unit/
        └── segmentationPipeline.test.ts
```

---

## 3. Implementation Phases

### Phase 1: Data Types & Uniform Grid + NMS Engine (`src/types/segmentationTypes.ts`, `src/tracking/gridNms.ts`)
1. Define `DetectedElement`, `AutoDetectParams` (`gridDensity`, `iouThreshold`, `minAreaPercent`), and updated `WorkerRequest` / `WorkerResponse` messages (`detectElementsOnFrame`, `propagateElements`).
2. Implement `generateUniformGridPoints`, `runLowResMaskNms` (IoU + containment suppression + stability scoring), `mergeSelectedElementLogits`, and `hitTestDetectedElements` in `src/tracking/gridNms.ts`.

### Phase 2: WebGPU Worker Update (`src/workers/samWorker.ts`)
1. Support `EdgeTamModel`, `Sam2Model`, and `SamModel` (`Xenova/slimsam-77-uniform`) without needing Grounding DINO.
2. Implement `detectElementsOnFrame`:
   - Compute frame embeddings once (`get_image_embeddings`).
   - Decode candidate masks across the uniform point grid.
   - Run low-res NMS (`runLowResMaskNms`) to select distinct elements.
   - Upscale surviving masks to full resolution, compute interior peaks/boxes, and return `DetectedElement[]`.
3. Implement `propagateElements`:
   - Compute target frame embeddings once and decode each selected element using its propagated padded bounding box + interior peak point.

### Phase 3: Interactive Selection Viewport & Left Inputs List (`src/components/topBar.ts`, `src/components/videoViewport.ts`, `src/rendering/frameCompositor.ts`)
1. Update `topBar.ts` to replace the text prompt box with **Auto-Detect Controls** (`grid pts`, `iou thresh`, `min area %`, `auto-detect`, `clear`) and a **Detected Elements List** with color swatches, confidence/area badges, and `all` / `none` selection buttons.
2. Update `videoViewport.ts` and `frameCompositor.ts` to render color-coded element overlays (hovered highlight, selected solid contour + fill, unselected dashed/subtle outline) and support pointer hover/click selection directly on the canvas.

### Phase 4: Multi-Element Propagation, ProRes Export & Verification
1. Update `src/tracking/maskPropagator.ts` and `src/main.ts` to manage element toggling, composite mask recomputation, and multi-element propagation across `[inFrame..outFrame]`.
2. Add unit tests for `generateUniformGridPoints`, `runLowResMaskNms`, `mergeSelectedElementLogits`, and `hitTestDetectedElements` in `tests/unit/segmentationPipeline.test.ts`.
3. Verify build (`npm run build`), unit tests (`npm run test:unit`), and end-to-end browser execution.
