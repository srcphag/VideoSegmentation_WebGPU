# Video Segmentation Web Application — UI Prototype Specification (Option A: Auto-Detect & Select)

## 1. Layout & Visual Style Overview

Layout and styling follow the exact conventions of **`https://github.com/srcphag/TextureMosaic`**:
- **Base CSS**: `letieu/terminal.css` + custom studio tokens (`--ts-bg-outer: #050505`, `--ts-bg-stage: #0d0d0d`, `--ts-cyan: #8be9fd`, `--ts-text: #cccccc`, `--ts-muted: #666666`, `--ts-border: #333333`).
- **3-Column Studio Grid (`100vw × 100vh`)**:
  - **Left Column (`319px`, `.ts-panel-inputs`)**: Inputs (Video Loader + Thumbnail, AI Model Selector, Runtime Status Badge, Auto-Detect Grid Scanner Controls, Detected Elements Selector List).
  - **Center Column (`1fr`, `.ts-panel-stage`)**: Header bar, Interactive Element-Selection & Composite Video Viewport Canvas, and Bottom Timeline & Keyframe Transport.
  - **Right Column (`270px`, `.ts-panel-params`)**: Parameters & Actions (Tracking Propagation, Preview Mode, Mask Edge Refinement, ProRes Render Output Mode & Profile, Export trigger).

```text
+---------------------------------------------------------------------------------------+
| LEFT: Inputs (319px)        | CENTER: Stage (1fr)              | RIGHT: Params (270px)|
| (topBar.ts)                 | (videoViewport.ts)               | (controlPanel.ts)    |
|                             |                                  |                      |
| - Video Loader + Thumbnail  | Header: Title | Res/FPS | Stats  | - Video Tracking     |
| - Model Selector            | +------------------------------+ |   [Propagate] + HUD  |
|   (EdgeTAM / SAM2 / SlimSAM)| |  Interactive Element Canvas  | | - Preview Mode       |
| - Runtime Badge (WebGPU)    | |  (Hover & click detected     | |   overlay|cutout|bw  |
| - Auto-Detect Scanner       | |   elements to toggle mask)   | | - Mask Refinement    |
|   grid / iou / min area     | +------------------------------+ |   threshold / choke  |
|   [auto-detect] [clear]     | Footer: Timeline (timelineBar.ts)|   / feather sliders  |
| - Detected Elements List    | [Play][<][>] 0042/0300 [In==◆=Out]| - ProRes Render      |
+---------------------------------------------------------------------------------------+
```

---

## 2. UI Sections & Components

### 2.1 Left Panel: Inputs & Auto-Detect (`src/components/topBar.ts`)
- **Video Loader (`.ts-source-block`)**:
  - `"load video"` button, `"demo clip"` button, and clickable `96×96` square preview thumbnail box (`.ts-source-preview`).
  - The bundled demo clip (`public/penguins.mp4`) is loaded automatically at startup (skip with `?demo=0`, procedural test clip with `?synthetic=1`).
  - Displays active file metadata pill (`filename`, `width × height`, `fps`, `totalFrames`).
- **Model Selector (`.ts-control-split`)**:
  - Dropdown to switch between **EdgeTAM** (`onnx-community/EdgeTAM-ONNX`), **SAM 2.1 Tiny** (`onnx-community/sam2.1-hiera-tiny-ONNX`), **SlimSAM 77** (`Xenova/slimsam-77-uniform`), **SAM 2.1 Small** (`onnx-community/sam2.1-hiera-small-ONNX`), and **SAM 2.1 Base+ (High Precision)** (`onnx-community/sam2.1-hiera-base-plus-ONNX`).
- **Runtime Badge**:
  - Displays active acceleration backend (`WebGPU` or `WASM`) and a compact `.progress` bar while model weights download or grid scanning runs.
- **Auto-Detect Grid Controls (Option A)**:
  - **Grid Density** (`grid pts`, `4` to `10` points per side, default `6` = 36 points).
  - **IoU Threshold** (`iou thresh`, `0.50` to `0.95`, default `0.72`).
  - **Min Area %** (`min area`, `0.5%` to `10%`, default `1.0%`).
  - **Action Buttons**: `auto-detect` (scans current frame for all distinct elements) and `clear`.
- **Detected Elements List**:
  - Scrollable list of all elements found in the current frame (`Element #1`, `Element #2`, ... with color swatch, area %, and IoU score).
  - Clicking an item (or clicking the element directly on the canvas) toggles its inclusion in the active mask. Includes `all` and `none` quick actions.

### 2.2 Center Panel: Interactive Selection Viewport (`src/components/videoViewport.ts`)
- **Stage Header (`.ts-section-heading`)**:
  - App title (`VideoSegmentation v0.1`), active video resolution & FPS label, `stats` HUD toggle, `reset all` button, and the render action buttons `snapshot png` (primary — downloads the current composite frame as PNG) and `export prores` (triggers the ProRes `.mov` render/export).
- **Empty State Dropzone**:
  - Drag-and-drop card for `.mp4`, `.webm`, and `.mov` files when no video is loaded.
- **Composite & Element-Selection Canvas (`.ts-render-canvas`)**:
  - Renders the current video frame together with detected element overlays.
  - **Hover Hit-Testing**: Moving the pointer over the canvas highlights the hovered element's contour and displays its label (`Element #k`).
  - **Click Selection**: Left-clicking a detected element on the canvas toggles its selection state (`selected = !selected`) and updates the active composite segmentation mask.

### 2.3 Right Panel: Inspector & Control Panel (`src/components/controlPanel.ts`)
- **Video Tracking Controls (`.ts-param-group`)**:
  - **Mask Actions**: `Propagate` button (tracks all selected elements across the `In → Out` frame range, toggles to `Stop` while running).
  - **Live Tracking Status**: Current frame progress (`Frame X / Y`), `ms/frame` speed, and a low-confidence warning badge if occlusion or drift is detected.
- **Preview Mode Switcher (`.ts-mode-row`)**:
  1. `overlay` — Color-coded detected elements (bright fill + contour for selected elements, subtle outline for unselected candidates).
  2. `alphaCutout` — Isolated selected element(s) rendered over a transparency checkerboard grid.
  3. `bwMatte` — Pure white (`#FFFFFF`) selected foreground on a pure black (`#000000`) background.
- **Mask Edge Refinement (`.ts-param-group`)**:
  - **Threshold** (`-2.0` to `+2.0`, default `0.0`).
  - **Choke / Expand** (`-10px` to `+10px` morphological erode/dilate, default `0px`).
  - **Edge Feather** (`0px` to `20px` Gaussian blur radius, default `1px`).
- **Render Output Mode & ProRes Export (`.ts-param-group`)**:
  - **Output Mode Selector (`.ts-mode-row`)**: `alpha` (ProRes 4444 with Transparency), `matte` (Black & White Luma Matte), `both`.
  - **ProRes Profile Selector**: `ProRes 4444` / `4444 XQ` for transparency; `ProRes 422 HQ` (default), `Standard`, `LT`, `Proxy`, or `4444` for B&W matte.
  - **Export Action & Progress**: `export .mov` button, live encoding progress bar, and encoding FPS readout.

### 2.4 Bottom Center: Timeline & Keyframe Scrubber (`src/components/timelineBar.ts`)
- **Transport Bar** (above the tracks): Play / Pause toggle, Step `-1` / `+1` frame, Jump to Previous/Next Keyframe on the left; `[ in` / `out ]` setters + numeric `In`/`Out` frame fields centered; right-aligned `frame N` + `MM:SS / MM:SS` timecode.
- **Double Timeline (TextureStack prototype style)**:
  1. **Keyframe/Status Track** (top, thin `10px` segmented canvas): one dash per frame — cyan = tracked, red = low confidence, dim gray = untracked, white = current frame, white diamond = keyframe.
  2. **Video Progress Track** (bottom, `14px`): cyan progress fill up to the playhead, `In`/`Out` range highlight, white playhead spanning both tracks. Clicking or dragging anywhere on the tracks scrubs instantly.
