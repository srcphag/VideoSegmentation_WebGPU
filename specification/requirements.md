# Video Segmentation Web Application — Requirements (Option A: Auto-Detect & Select)

## 1. Overview
A 100% client-side web application styled after **`TextureMosaic`** (`letieu/terminal.css` 3-column dark studio layout) that automatically discovers segmentable elements in a video frame using **Option A: Uniform Grid Prompting + Non-Maximum Suppression (NMS)** on **WebGPU** (**EdgeTAM** / **SAM 2.1 Tiny** / **SlimSAM**). Users visually click the detected elements they want to keep, propagate the selected masks across the video timeline, and encode `.mov` files directly in the browser via **`prores-wasm-encoder`** (as **ProRes 4444 with Alpha Transparency**, **Black & White Luma Matte**, or **Both**).

---

## 2. Functional Requirements

### 2.1 Video Input & Playback
- **FR-01**: Load local video files (`.mp4`, `.webm`, `.mov`) via the Left `Inputs` panel file button, thumbnail box, or center viewport dropzone without server uploads.
- **FR-02**: Extract and display video metadata (`filename`, `width × height`, `fps`, `totalFrames`, `duration`) and a square thumbnail preview in the `Inputs` panel.
- **FR-03**: Provide instantaneous (non-smoothed) frame-accurate timeline scrubbing, play/pause, step `-1` / `+1` frame, jump between keyframes, and `In` / `Out` frame range markers.

### 2.2 Automatic Element Discovery (Option A: Uniform Grid + NMS) & Interactive Selection
- **FR-04**: Support in-browser model selection between:
  - **EdgeTAM** (`onnx-community/EdgeTAM-ONNX`) — default mobile-optimized SAM 2 tracker.
  - **SAM 2.1 Tiny** (`onnx-community/sam2.1-hiera-tiny-ONNX`).
  - **SlimSAM 77** (`Xenova/slimsam-77-uniform`).
  - **SAM 2.1 Small** (`onnx-community/sam2.1-hiera-small-ONNX`) — higher precision tracker.
  - **SAM 2.1 Base+ (High Precision)** (`onnx-community/sam2.1-hiera-base-plus-ONNX`) — strongest detection accuracy.
- **FR-05**: Provide an **Auto-Detect** scanner in the Left `Inputs` panel with configurable parameters:
  - **Grid Density** (`4` to `10` points per side, default `6` = 36 uniform sample points).
  - **IoU Threshold** (`0.50` to `0.95`, default `0.72`).
  - **Min Area %** (`0.5%` to `10.0%` of frame area, default `1.0%`).
- **FR-06**: When **Auto-Detect** runs on a frame:
  1. Compute vision encoder embeddings once for the frame.
  2. Sample a $G \times G$ uniform grid of points across the frame and decode candidate masks.
  3. Filter candidates by IoU confidence, stability, and min/max area fraction, then deduplicate overlapping regions via Non-Maximum Suppression (NMS) and containment filtering.
  4. Return distinct `DetectedElement` entries, each with a full-resolution quantized logit mask, bounding box, interior peak point, IoU score, and distinct color swatch.
- **FR-07**: Allow the user to select/deselect which detected elements to keep by:
  - Clicking directly on the element inside the center **Video Viewport Canvas** (with hover highlight feedback), OR
  - Toggling the element in the **Detected Elements List** in the Left `Inputs` panel (including `select all` / `select none` buttons).

### 2.3 Multi-Frame Video Tracking & Propagation
- **FR-08**: Store frames with selected elements as **Keyframes** (`◆`) on the timeline.
- **FR-09**: Provide a **Propagate** action in the Right `Control Panel` that tracks all selected elements forward across the `[In..Out]` frame range:
  - For each selected element on frame $t$, derives a padded bounding box and a 2-pass Chamfer Distance Transform interior peak point to prompt the SAM decoder on frame $t + 1$, merging the resulting masks into the frame's composite mask.
- **FR-10**: Display live tracking telemetry (`Frame X / Y`, `ms/frame` speed, low-confidence warning badge) and allow stopping/resuming propagation at any frame.

### 2.4 Mask Refinement & Viewport Preview
- **FR-11**: Provide real-time mask edge refinement controls in the Right `Control Panel`:
  - **Threshold** (`-2.0` to `+2.0`, default `0.0`)
  - **Choke / Expand** (`-10px` to `+10px` morphological erode/dilate, default `0px`)
  - **Edge Feather** (`0px` to `20px` separable Gaussian blur radius, default `1px`)
- **FR-12**: Provide 3 viewport preview modes:
  - `overlay` — Displays all detected candidate contours (subtle) and highlights selected elements (vibrant fill + bright contour).
  - `alphaCutout` — Isolated selected element(s) over a checkerboard transparency grid.
  - `bwMatte` — Pure white (`#FFFFFF`) selected foreground on pure black (`#000000`) background.

### 2.5 ProRes `.mov` Rendering & Export (`prores-wasm-encoder`)
- **FR-13**: Encode `.mov` files directly in the browser via `prores-wasm-encoder` in three modes:
  - **ProRes with Transparency** (`ProResProfile.P4444` or `ProResProfile.P4444XQ`) using straight (non-premultiplied) RGBA bytes.
  - **Black & White Luma Matte** (`ProResProfile.HQ`, `STANDARD`, `LT`, `PROXY`, or `P4444`).
  - **Both** (exports both `.mov` files).
- **FR-14**: Display frame-by-frame encoding progress, encoding FPS, and cancelation support.

---

## 3. Non-Functional Requirements

- **NFR-01 (UI Style & Layout Consistency)**: Must follow the `TextureMosaic` UI architecture (`letieu/terminal.css`, dark terminal palette, 3-column grid, split prefix inputs, synchronized slider + numeric input + `↺` reset buttons).
- **NFR-02 (100% Client-Side Execution)**: All grid auto-detection, NMS, propagation, compositing, and ProRes `.mov` encoding run locally in the browser via WebGPU, WebAssembly, and Web Workers.
- **NFR-03 (Naming Standard)**: All folders and filenames must follow `camelCase` (`AGENTS.md`).
