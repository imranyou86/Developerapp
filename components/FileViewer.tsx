"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";

export interface ViewableFile {
  file_name: string;
  storage_url: string;
  // Used both for the header's "Download" link and, when this turns out to
  // be a PDF, as the fetch source for pdfjs. Callers with their own
  // same-origin download proxy (e.g. the Files tab) should pass that
  // instead of storage_url directly — a script fetch() of a cross-origin
  // Storage URL is CORS-checked, unlike a plain <img>/<iframe> embed of it.
  downloadUrl: string;
}

export function isImage(url: string): boolean {
  return /\.(png|jpe?g|gif|webp|avif)(\?|$)/i.test(url);
}

export function isPdf(url: string): boolean {
  return /\.pdf(\?|$)/i.test(url);
}

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 4;
const ZOOM_STEP = 0.25;

// A separate full-bleed overlay rather than the shared Modal — Modal's card
// chrome (max-w-md, padded body) doesn't fit a full-size image/PDF viewer.
export function FileViewerModal({
  files,
  startIndex,
  onClose,
}: {
  files: ViewableFile[];
  startIndex: number;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(startIndex);
  const [zoom, setZoom] = useState(1);
  const file = files[index];
  const canGoPrev = index > 0;
  const canGoNext = index < files.length - 1;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") setIndex((i) => Math.max(0, i - 1));
      else if (e.key === "ArrowRight") setIndex((i) => Math.min(files.length - 1, i + 1));
      else if (e.key === "+" || e.key === "=") setZoom((z) => Math.min(ZOOM_MAX, z + ZOOM_STEP));
      else if (e.key === "-") setZoom((z) => Math.max(ZOOM_MIN, z - ZOOM_STEP));
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [files.length, onClose]);

  // Reset zoom when moving to a different file, so it doesn't carry over.
  useEffect(() => {
    setZoom(1);
  }, [index]);

  if (!file || typeof document === "undefined") return null;

  const image = isImage(file.storage_url);
  const pdf = isPdf(file.storage_url);

  return createPortal(
    <div className="fixed inset-0 z-50 flex flex-col bg-blueprint-dark/95 animate-fade-in" onClick={onClose}>
      <div
        className="flex shrink-0 flex-wrap items-center justify-between gap-2 px-4 py-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-white" title={file.file_name}>
            {file.file_name}
          </p>
          {files.length > 1 && (
            <p className="text-xs text-white/50">
              Page {index + 1} of {files.length}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {(image || pdf) && (
            <div className="flex items-center gap-1 rounded-md bg-white/10 px-1 py-1">
              <button
                type="button"
                className="rounded px-2 py-1 text-sm text-white hover:bg-white/10 disabled:opacity-30"
                onClick={() => setZoom((z) => Math.max(ZOOM_MIN, z - ZOOM_STEP))}
                disabled={zoom <= ZOOM_MIN}
                aria-label="Zoom out"
              >
                −
              </button>
              <span className="w-11 text-center text-xs text-white/70">{Math.round(zoom * 100)}%</span>
              <button
                type="button"
                className="rounded px-2 py-1 text-sm text-white hover:bg-white/10 disabled:opacity-30"
                onClick={() => setZoom((z) => Math.min(ZOOM_MAX, z + ZOOM_STEP))}
                disabled={zoom >= ZOOM_MAX}
                aria-label="Zoom in"
              >
                +
              </button>
              {zoom !== 1 && (
                <button
                  type="button"
                  className="rounded px-2 py-1 text-xs text-white/70 hover:bg-white/10"
                  onClick={() => setZoom(1)}
                >
                  Reset
                </button>
              )}
            </div>
          )}
          <a
            href={file.downloadUrl}
            className="rounded-md bg-white/10 px-3 py-1.5 text-xs font-medium text-white hover:bg-white/20"
          >
            Download
          </a>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md bg-white/10 px-3 py-1.5 text-xs font-medium text-white hover:bg-white/20"
          >
            Close
          </button>
        </div>
      </div>

      <div className="relative min-h-0 flex-1 overflow-auto" onClick={(e) => e.stopPropagation()}>
        {image ? (
          <div className="flex min-h-full items-center justify-center p-4">
            {/* eslint-disable-next-line @next/next/no-img-element -- needs
                unconstrained natural sizing under a CSS zoom transform, which
                next/image's layout modes don't support cleanly. */}
            <img
              src={file.storage_url}
              alt={file.file_name}
              className="max-h-[85vh] max-w-full select-none object-contain transition-transform duration-150"
              style={{ transform: `scale(${zoom})` }}
              draggable={false}
            />
          </div>
        ) : pdf ? (
          <PdfViewer file={file} zoom={zoom} />
        ) : (
          <div className="flex h-full items-center justify-center px-4 text-center text-sm text-white/70">
            This file type can&apos;t be previewed in-app — use Download above instead.
          </div>
        )}

        {canGoPrev && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setIndex((i) => Math.max(0, i - 1));
            }}
            className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-white/10 px-3 py-2 text-lg text-white hover:bg-white/20"
            aria-label="Previous page"
          >
            ‹
          </button>
        )}
        {canGoNext && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setIndex((i) => Math.min(files.length - 1, i + 1));
            }}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-white/10 px-3 py-2 text-lg text-white hover:bg-white/20"
            aria-label="Next page"
          >
            ›
          </button>
        )}
      </div>
    </div>,
    document.body
  );
}

// Rendered at a fixed multiple of its fit-to-width size up front, then just
// resized via CSS on zoom — re-rendering the PDF canvas on every zoom click
// would be needlessly slow for a control meant to feel instant.
const PDF_RENDER_OVERSAMPLE = 2;

function PdfViewer({ file, zoom }: { file: ViewableFile; zoom: number }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [pages, setPages] = useState<PDFPageProxy[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fitWidth, setFitWidth] = useState(600);

  useEffect(() => {
    function measure() {
      if (containerRef.current) setFitWidth(Math.max(200, containerRef.current.clientWidth - 32));
    }
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let doc: PDFDocumentProxy | null = null;
    setPages(null);
    setError(null);
    (async () => {
      try {
        const pdfjsLib = await import("pdfjs-dist");
        pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
        const res = await fetch(file.downloadUrl);
        if (!res.ok) throw new Error("Could not download this PDF.");
        const arrayBuffer = await res.arrayBuffer();
        if (cancelled) return;
        doc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        if (cancelled) return;
        const loaded: PDFPageProxy[] = [];
        for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
          loaded.push(await doc.getPage(pageNum));
        }
        if (!cancelled) setPages(loaded);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load this PDF.");
      }
    })();
    return () => {
      cancelled = true;
      doc?.destroy();
    };
  }, [file.downloadUrl]);

  return (
    <div ref={containerRef} className="flex min-h-full flex-col items-center gap-3 p-4">
      {error && <p className="text-sm text-white/70">{error}</p>}
      {!error && !pages && <p className="text-sm text-white/50">Loading PDF…</p>}
      {pages?.map((page, i) => <PdfPageCanvas key={i} page={page} fitWidth={fitWidth} zoom={zoom} />)}
    </div>
  );
}

function PdfPageCanvas({ page, fitWidth, zoom }: { page: PDFPageProxy; fitWidth: number; zoom: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [displaySize, setDisplaySize] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const canvas = canvasRef.current;
      const context = canvas?.getContext("2d");
      if (!canvas || !context) return;
      const naturalWidth = page.getViewport({ scale: 1 }).width;
      const fitScale = fitWidth / naturalWidth;
      const renderViewport = page.getViewport({ scale: fitScale * PDF_RENDER_OVERSAMPLE });
      canvas.width = renderViewport.width;
      canvas.height = renderViewport.height;
      await page.render({ canvasContext: context, viewport: renderViewport }).promise;
      if (!cancelled) {
        setDisplaySize({ width: renderViewport.width / PDF_RENDER_OVERSAMPLE, height: renderViewport.height / PDF_RENDER_OVERSAMPLE });
      }
    })();
    return () => {
      cancelled = true;
    };
    // fitWidth only changes on container resize (rare) — re-rendering per
    // zoom tick is handled by the CSS resize below instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, fitWidth]);

  return (
    <canvas
      ref={canvasRef}
      className="block bg-white shadow-md"
      style={displaySize ? { width: displaySize.width * zoom, height: displaySize.height * zoom } : undefined}
    />
  );
}
