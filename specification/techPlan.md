# Video Segmentation Web Application — Technical Plan (Option A: Uniform Grid Auto-Detect & Select)

## 1. System Architecture

The application is a 100% browser-based studio built with **Vite + Vanilla TypeScript** following the UI architecture of **`TextureMosaic`** (`letieu/terminal.css` + 3-column grid):

1. **Main Thread (`src/main.ts`, `src/components/*`, `src/rendering/*`)**:
   - Manages application state, `TextureMosaic`-style DOM panels (`topBar.ts`, `videoViewport.ts`, `controlPanel.ts`, `timelineBar.ts`), latest-only instantaneous video scrubbing (`videoFrameManager.ts`), canvas hit-testing for interactive element selection, mask edge post-processing (`maskPostProcessor.ts`), and real-time preview compositing (`frameCompositor.ts`).
2. **AI Grid Auto-Detection & Tracking Worker (`src/workers/samWorker.ts` + `src/tracking/gridNms.ts`)**:
   - Runs `@huggingface/transformers` on **WebGPU** (with automatic WASM fallback).
   - Supports **EdgeTAM** (`onnx-community/EdgeTAM-ONNX`, `EdgeTamModel`), **SAM 2.1 Tiny** (`onnx-community/sam2.1-hiera-tiny-ONNX`, `Sam2Model`), and **SlimSAM 77** (`Xenova/slimsam-77-uniform`, `SamModel`).
   - Executes **Option A Uniform Grid Prompting + Low-Res NMS** to automatically discover all distinct visual elements in a frame, plus fast multi-element box+point propagation across video frames.
3. **ProRes Encoder (`src/rendering/proresExporter.ts`)**:
   - Uses `prores-wasm-encoder` (`createProResEncoder`, `movToBlob`) to encode straight-RGBA ProRes 4444 or B&W Luma Matte `.mov` files.

---

## 2. Option A: Uniform Grid Auto-Detection & NMS Pipeline

### 2.1 Uniform Grid Generation (`src/tracking/gridNms.ts`)
Given frame dimensions $(W, H)$ and user-selected `gridDensity` $G \in [4..10]$ (default $G = 6$, yielding $36$ points):
$$x_c = \text{round}\left(\frac{(c + 0.5) \cdot W}{G}\right), \quad y_r = \text{round}\left(\frac{(r + 0.5) \cdot H}{G}\right), \quad r, c \in \{0, \dots, G - 1\}$$

### 2.2 Single-Pass Frame Embedding & Fast Point Decoding (`src/workers/samWorker.ts`)
1. Compute `processedFrame = await samProcessor(rawImage)` and `embeddings = await samModel.get_image_embeddings({ pixel_values })` **once** for the frame.
2. Iterate through the $G \times G$ grid points:
   - Reshape each point `[[[[px, py]]]]` (`[1, 1, 1, 2]`) and label `[[[1]]]` (`[1, 1, 1]`).
   - Run `outputs = await samModel({ ...embeddings, input_points, input_labels })` (~20–25 ms/point on WebGPU because `embeddings` are cached).
   - Inspect the 3 multi-scale candidate masks in `outputs.pred_masks` (`[1, 1, 3, 256, 256]`) and `outputs.iou_scores` (`[1, 1, 3]`):
     - Compute low-res area fraction (`logits > 0.0`) and stability ratio (`area(logits > +1.0) / area(logits > -1.0)`).
     - Select the candidate channel with the highest `iouScore * stabilityScore` whose area fraction lies within `[minAreaFraction, 0.92]`.
     - Discard candidates with `iouScore < iouThreshold` or `stabilityScore < 0.65`.
   - Emit incremental worker progress (`modelProgress`) so the user sees live scan progress.

### 2.3 Low-Res Non-Maximum Suppression (NMS) & Containment Filtering (`src/tracking/gridNms.ts`)
Before running expensive full-resolution bilinear upscaling (`post_process_masks`), filter the surviving low-res `256×256` candidates:
1. Sort candidates descending by `rankScore = iouScore * stabilityScore`.
2. Greedily accept a candidate if for all already-accepted masks $M_j$:
   - Pairwise Intersection-over-Union $\text{IoU}(M_i, M_j) < 0.55$, AND
   - Containment ratio $\frac{|M_i \cap M_j|}{\min(|M_i|, |M_j|)} < 0.80$ (prevents keeping duplicate sub-fragments of the same object).
3. Cap at `maxElements = 14` distinct elements per frame.
4. Upscale only the accepted masks to full video resolution $(W, H)$, quantize logits to `Uint8Array(W * H)`, compute bounding box + 2-pass Chamfer distance-transform interior peak (`computeMaskInteriorPeakAndBox`), and assign a distinct color from the studio palette.

---

## 3. Interactive Selection, Multi-Element Propagation & ProRes Export

### 3.1 Interactive Canvas Hit-Testing & Selection
- Each frame's `FrameMaskEntry` stores:
  - `elements: DetectedElement[]` (all auto-detected elements on the frame, each with `id`, `label`, `color`, `selected`, `iouScore`, `areaFraction`, `bbox`, `peakPoint`, `quantizedLogits`).
  - `quantizedLogits: Uint8Array` (the composite mask formed by the element-wise maximum of all currently `selected` elements).
- When the user hovers over `(x, y)` on the viewport canvas, hit-testing finds the smallest-area `DetectedElement` where `element.quantizedLogits[y * W + x] > 128` and highlights its contour.
- Clicking `(x, y)` on the canvas (or clicking the element's row in the Left `Inputs` panel) toggles `element.selected`, recomputes the composite `quantizedLogits` in `<2ms`, and re-renders the viewport immediately.

### 3.2 Multi-Element Frame-to-Frame Propagation
When the user clicks **Propagate**:
1. Take all `selected` elements from the start keyframe $t$.
2. For each subsequent frame $t + 1 \in [\text{inFrame}..\text{outFrame}]$:
   - Compute frame $t + 1$'s image embeddings **once**.
   - For each active tracked element $k$, compute its padded bounding box (`[1, 1, 4]`) and 2-pass Chamfer distance-transform interior peak point (`[1, 1, 1, 2]`) from frame $t$, and run `samModel({ ...embeddings, input_boxes, input_points, input_labels })` on frame $t + 1$.
   - Store the updated per-element masks and their merged composite `quantizedLogits` on frame $t + 1$.
3. ProRes `.mov` export (`exportProResMovs`) composites the merged `quantizedLogits` with `postProcessMask` into straight-RGBA (`ProRes 4444`) or grayscale (`B&W Luma Matte`) frames.
