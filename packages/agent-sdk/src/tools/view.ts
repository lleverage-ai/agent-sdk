/**
 * View tool for visual file inspection.
 *
 * Enables agents to "see" images, PDFs, and DOCX files by converting them
 * to image content that the model can process visually — similar to how
 * Claude Code's Read tool handles multimodal files.
 *
 * ## Image sizing rationale (Claude Opus 4.6)
 *
 * Claude auto-downscales images with long edge > 1568px or > ~1600 tokens.
 * Token cost for images: `tokens ≈ (width × height) / 750`.
 *
 * For A4 pages at 110 DPI → 910×1286px → ~1560 tokens — the sweet spot
 * that maximizes text readability while staying under the resize threshold.
 *
 * Uses PNG (not JPEG) because PDF pages are text-heavy content where
 * JPEG compression artifacts can destroy small glyphs and table lines.
 *
 * ## Important: use `image-data`, not `file-data`
 *
 * The Anthropic provider in AI SDK only supports `file-data` for PDFs
 * (as document blocks). For images in tool results, you must use `image-data`
 * — otherwise images are silently dropped. This tool also uses `toModelOutput`
 * on the tool definition to ensure images are sent as proper image blocks
 * (~1560 tokens each) rather than serialized as JSON text (~150K tokens each).
 *
 * Supported formats:
 * - **Images** (PNG, JPG, GIF, WebP): read directly as base64
 * - **PDF**: pages rendered to images via PyMuPDF (pymupdf/fitz)
 * - **DOCX**: converted to PDF via docx2pdf, then rendered to images
 *
 * Requires Python with `pymupdf` and `Pillow` installed. DOCX support also
 * requires `docx2pdf` and Microsoft Word (Windows) or LibreOffice (macOS/Linux).
 *
 * @packageDocumentation
 */

import { tool } from "ai";
import { z } from "zod";
import type { ExecutableBackend } from "../backend.js";
import { hasExecuteCapability } from "../backend.js";
import type { BackendProtocol } from "../backend.js";

// =============================================================================
// Constants — derived from Claude vision research
// =============================================================================

/**
 * Maximum pages to render per call. Keep low to manage context budget.
 * Each A4 page at 110 DPI ≈ 1560 tokens, so 2 pages ≈ 3120 tokens.
 */
const MAX_PAGES = 2;

/**
 * DPI for PDF page rendering.
 *
 * 110 DPI for A4/Letter produces ~910×1286px ≈ 1.17MP ≈ 1560 tokens on Claude.
 * This is the optimal point: just under the 1568px / 1600-token resize threshold,
 * giving maximum text readability without triggering auto-downscaling.
 */
const RENDER_DPI = 110;

/**
 * Maximum long edge in pixels. Claude downscales anything above 1568px
 * with no quality benefit — only increased latency.
 */
const MAX_LONG_EDGE = 1568;

/** Image file extensions recognized for direct reading */
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg"]);

/**
 * Python script that converts PDF pages to base64-encoded PNGs.
 *
 * Uses PNG (not JPEG) because rendered pages contain text and table lines
 * where JPEG artifacts degrade readability. Constrains output to ≤1568px
 * long edge to avoid Claude's auto-downscaling penalty.
 *
 * Composites transparent backgrounds onto white before encoding.
 */
const PDF_TO_BASE64_SCRIPT = `
import fitz, sys, base64, json, io
from PIL import Image

path = sys.argv[1]
start = int(sys.argv[2])
count = int(sys.argv[3])
dpi = int(sys.argv[4])
max_edge = int(sys.argv[5])

doc = fitz.open(path)
total = doc.page_count
end = min(start + count, total)
results = []

for i in range(start, end):
    page = doc[i]
    pix = page.get_pixmap(dpi=dpi)
    mode = "RGBA" if pix.alpha else "RGB"
    img = Image.frombytes(mode, [pix.width, pix.height], pix.samples)
    # Composite transparency onto white background
    if img.mode == "RGBA":
        bg = Image.new("RGB", img.size, (255, 255, 255))
        bg.paste(img, mask=img.split()[3])
        img = bg
    # Constrain to max long edge (avoid Claude auto-downscaling penalty)
    w, h = img.size
    long_edge = max(w, h)
    if long_edge > max_edge:
        scale = max_edge / long_edge
        img = img.resize((int(w * scale), int(h * scale)), Image.LANCZOS)
    w, h = img.size
    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    b64 = base64.b64encode(buf.getvalue()).decode("ascii")
    results.append({"page": i + 1, "b64": b64, "width": w, "height": h})

doc.close()
print(json.dumps({"total_pages": total, "rendered": results}))
`;

/** Python script that converts DOCX to a temporary PDF */
const DOCX_TO_PDF_SCRIPT = `
import sys, os, tempfile
from docx2pdf import convert

docx_path = sys.argv[1]
out_dir = tempfile.mkdtemp()
pdf_path = os.path.join(out_dir, "converted.pdf")
convert(docx_path, pdf_path)
print(pdf_path)
`;

// =============================================================================
// Types
// =============================================================================

/** Options for creating the view tool */
export interface ViewToolOptions {
  /**
   * Maximum number of pages to render per call.
   * Each page costs ~1560 tokens at default DPI.
   * @defaultValue 2
   */
  maxPages?: number;

  /**
   * DPI for PDF page rendering.
   *
   * 110 DPI is optimal for A4 pages on Claude (≈1560 tokens/page).
   * Lower for faster/cheaper previews, higher for dense text (but
   * images exceeding 1568px long edge get auto-downscaled anyway).
   *
   * @defaultValue 110
   */
  dpi?: number;

  /**
   * Maximum long edge in pixels. Images larger than this are
   * downscaled to avoid Claude's auto-resize penalty.
   * @defaultValue 1568
   */
  maxLongEdge?: number;
}

// =============================================================================
// View Tool
// =============================================================================

/**
 * Creates a tool that lets agents visually inspect files.
 *
 * The tool reads image files directly and converts PDF/DOCX pages to images,
 * returning them as multimodal content the model can see.
 *
 * ## Token budget
 *
 * At default settings (110 DPI, max 2 pages), each call costs ~3120 tokens
 * of image content. A full 9-page document review requires 5 calls ≈ 15K tokens.
 *
 * ## Critical implementation notes
 *
 * This tool uses `toModelOutput` to return results as `{ type: 'content' }` with
 * `image-data` parts. Without `toModelOutput`, the AI SDK serializes image data as
 * JSON text, inflating each page from ~1560 to ~150K tokens. And `image-data` (not
 * `file-data`) is required because the Anthropic provider only maps `image-data` to
 * image blocks — `file-data` with image MIME types is silently dropped.
 *
 * @param backend - Backend with execute capability (enableBash: true)
 * @param options - Optional configuration
 * @returns An AI SDK compatible tool for viewing files
 *
 * @example
 * ```typescript
 * import { createViewTool, createAgent, FilesystemBackend } from "@lleverage-ai/agent-sdk";
 *
 * const backend = new FilesystemBackend({
 *   rootDir: "/project",
 *   enableBash: true,
 * });
 *
 * const agent = createAgent({
 *   model,
 *   tools: { view: createViewTool(backend) },
 * });
 * ```
 *
 * @category Tools
 */
export function createViewTool(backend: BackendProtocol, options?: ViewToolOptions) {
  const maxPages = options?.maxPages ?? MAX_PAGES;
  const dpi = options?.dpi ?? RENDER_DPI;
  const maxLongEdge = options?.maxLongEdge ?? MAX_LONG_EDGE;

  return tool({
    description:
      "View a file visually. Supports images (PNG/JPG/GIF/WebP), PDFs, and DOCX files. " +
      "For PDFs and DOCX, renders pages as images so you can see the layout, tables, and formatting. " +
      `Each page costs ~1560 tokens. Max ${maxPages} pages per call — use start_page to paginate.`,
    inputSchema: z.object({
      file_path: z.string().describe("Absolute path to the file to view"),
      start_page: z
        .number()
        .optional()
        .describe("First page to render (1-indexed, default: 1). Only for PDF/DOCX."),
      page_count: z
        .number()
        .optional()
        .describe(`Number of pages to render (default/max: ${maxPages}). Only for PDF/DOCX.`),
    }),
    // Convert tool result to proper multimodal content so images are sent as
    // image blocks (~1560 tokens each) rather than serialized as JSON text
    // (~150K tokens each). Without this, the AI SDK wraps the result as
    // { type: 'json', value: ... } and the base64 data counts as text tokens.
    toModelOutput: ({ output }: { output: unknown; toolCallId: string; input: unknown }) => {
      const result = output as Record<string, unknown>;
      if (result && result.type === "content" && Array.isArray(result.value)) {
        return { type: "content" as const, value: result.value };
      }
      // Fallback: text-only results (errors, unsupported formats)
      return { type: "text" as const, value: typeof result === "string" ? result : JSON.stringify(result) };
    },
    execute: async ({
      file_path,
      start_page,
      page_count,
    }: {
      file_path: string;
      start_page?: number;
      page_count?: number;
    }) => {
      const ext = file_path.slice(file_path.lastIndexOf(".")).toLowerCase();

      // --- Images: read directly ---
      if (IMAGE_EXTENSIONS.has(ext)) {
        return await viewImage(backend, file_path, ext, maxLongEdge);
      }

      // --- PDF/DOCX: need bash for Python conversion ---
      if (!hasExecuteCapability(backend)) {
        return "Error: viewing PDF/DOCX files requires a backend with enableBash: true";
      }

      const execBackend = backend as ExecutableBackend & BackendProtocol;
      const pages = Math.min(page_count ?? maxPages, maxPages);
      const start = Math.max((start_page ?? 1) - 1, 0); // convert to 0-indexed

      if (ext === ".pdf") {
        return await viewPdf(execBackend, file_path, start, pages, dpi, maxLongEdge);
      }

      if (ext === ".docx" || ext === ".doc") {
        return await viewDocx(execBackend, file_path, start, pages, dpi, maxLongEdge);
      }

      return `Error: unsupported file type "${ext}". Supported: images (${[...IMAGE_EXTENSIONS].join(", ")}), .pdf, .docx`;
    },
  });
}

// =============================================================================
// Internal helpers
// =============================================================================

async function viewImage(backend: BackendProtocol, filePath: string, ext: string, maxLongEdge: number) {
  if (!hasExecuteCapability(backend)) {
    return `[Image file at ${filePath} — viewing requires enableBash: true on the backend]`;
  }

  const execBackend = backend as ExecutableBackend & BackendProtocol;

  // Read, resize if needed (stay under Claude's 1568px long edge), and base64-encode.
  // Uses PNG for lossless quality on screenshots/diagrams, JPEG passthrough for photos.
  const result = await execBackend.execute(
    `python -c "
import base64, sys, io
from PIL import Image

img = Image.open(sys.argv[1])
if img.mode == 'RGBA':
    bg = Image.new('RGB', img.size, (255,255,255))
    bg.paste(img, mask=img.split()[3])
    img = bg
elif img.mode != 'RGB':
    img = img.convert('RGB')

w, h = img.size
mx = ${maxLongEdge}
if max(w,h) > mx:
    s = mx / max(w,h)
    img = img.resize((int(w*s), int(h*s)), Image.LANCZOS)

buf = io.BytesIO()
fmt = 'PNG' if sys.argv[1].lower().endswith('.png') else 'JPEG'
img.save(buf, format=fmt, quality=85, optimize=True)
print(base64.b64encode(buf.getvalue()).decode())
" "${filePath}"`,
  );

  if (result.exitCode === 0 && result.output.trim()) {
    const mimeType = extToMimeType(ext);
    return {
      type: "content" as const,
      value: [
        { type: "text" as const, text: `Image: ${filePath}` },
        { type: "image-data" as const, data: result.output.trim(), mediaType: mimeType },
      ],
    };
  }

  return `Error viewing image: ${result.output}`;
}

async function viewPdf(
  backend: ExecutableBackend & BackendProtocol,
  filePath: string,
  startPage: number,
  pageCount: number,
  dpi: number,
  maxLongEdge: number,
) {
  const scriptPath = filePath.replace(/[^/\\]+$/, "_view_pdf.py");
  await backend.write(scriptPath, PDF_TO_BASE64_SCRIPT.trim());

  try {
    const result = await backend.execute(
      `python "${scriptPath}" "${filePath}" ${startPage} ${pageCount} ${dpi} ${maxLongEdge}`,
    );

    if (result.exitCode !== 0) {
      return `Error rendering PDF: ${result.output}`;
    }

    const data = JSON.parse(result.output.trim()) as {
      total_pages: number;
      rendered: Array<{ page: number; b64: string; width: number; height: number }>;
    };

    const contentParts: Array<
      | { type: "text"; text: string }
      | { type: "image-data"; data: string; mediaType: string }
    > = [];

    contentParts.push({
      type: "text" as const,
      text: `PDF: ${filePath} — ${data.total_pages} pages total, showing page${data.rendered.length > 1 ? "s" : ""} ${data.rendered.map((p) => p.page).join(", ")} (~${data.rendered.length * 1560} image tokens)`,
    });

    for (const page of data.rendered) {
      contentParts.push({
        type: "text" as const,
        text: `— Page ${page.page} (${page.width}×${page.height}px, ~${Math.round((page.width * page.height) / 750)} tokens) —`,
      });
      contentParts.push({
        type: "image-data" as const,
        data: page.b64,
        mediaType: "image/png",
      });
    }

    return { type: "content" as const, value: contentParts };
  } finally {
    try {
      await backend.execute(`python -c "import os; os.remove('${scriptPath.replace(/\\/g, "/")}')"`);
    } catch {
      // Best-effort cleanup
    }
  }
}

async function viewDocx(
  backend: ExecutableBackend & BackendProtocol,
  filePath: string,
  startPage: number,
  pageCount: number,
  dpi: number,
  maxLongEdge: number,
) {
  const scriptPath = filePath.replace(/[^/\\]+$/, "_view_docx.py");
  await backend.write(scriptPath, DOCX_TO_PDF_SCRIPT.trim());

  const convertResult = await backend.execute(`python "${scriptPath}" "${filePath}"`);

  if (convertResult.exitCode !== 0) {
    return `Error converting DOCX to PDF: ${convertResult.output}`;
  }

  const pdfPath = convertResult.output.trim();

  try {
    return await viewPdf(backend, pdfPath, startPage, pageCount, dpi, maxLongEdge);
  } finally {
    try {
      await backend.execute(
        `python -c "import os,shutil; os.remove('${scriptPath.replace(/\\/g, "/")}'); shutil.rmtree(os.path.dirname('${pdfPath.replace(/\\/g, "/")}'))"`,
      );
    } catch {
      // Best-effort cleanup
    }
  }
}

function extToMimeType(ext: string): string {
  switch (ext) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    case ".bmp":
      return "image/bmp";
    case ".svg":
      return "image/svg+xml";
    default:
      return "image/png";
  }
}
