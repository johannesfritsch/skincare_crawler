/**
 * Barcode detection abstraction.
 *
 * Uses the native BarcodeDetector API when available (Chrome, Edge, Safari 17.2+),
 * falling back to zxing-wasm (WebAssembly) for Firefox and older browsers.
 */

const EAN_FORMATS_NATIVE = ['ean_13', 'ean_8'] as const
const EAN_FORMATS_ZXING = ['EAN-13', 'EAN-8'] as const

let nativeDetector: BarcodeDetector | null = null
let nativeSupported: boolean | null = null

/** Feature-detect native BarcodeDetector with EAN support */
async function isNativeSupported(): Promise<boolean> {
  if (nativeSupported !== null) return nativeSupported

  if (typeof BarcodeDetector === 'undefined') {
    nativeSupported = false
    return false
  }

  try {
    const formats = await BarcodeDetector.getSupportedFormats()
    nativeSupported = EAN_FORMATS_NATIVE.some((f) => formats.includes(f))
  } catch {
    nativeSupported = false
  }

  return nativeSupported
}

function getNativeDetector(): BarcodeDetector {
  if (!nativeDetector) {
    nativeDetector = new BarcodeDetector({
      formats: [...EAN_FORMATS_NATIVE],
    })
  }
  return nativeDetector
}

/** Lazily import zxing-wasm reader (only loaded when native is unavailable) */
async function detectWithZxing(imageData: ImageData): Promise<string | null> {
  const { readBarcodes } = await import('zxing-wasm/reader')

  const results = await readBarcodes(imageData, {
    formats: [...EAN_FORMATS_ZXING],
    tryHarder: true,
    tryRotate: false,
    tryInvert: false,
    maxNumberOfSymbols: 1,
  })

  const hit = results.find((r) => r.isValid && r.text)
  return hit?.text ?? null
}

async function detectWithNative(source: ImageBitmap): Promise<string | null> {
  const detector = getNativeDetector()
  const results = await detector.detect(source)

  const hit = results.find((r) => r.rawValue)
  return hit?.rawValue ?? null
}

/**
 * Detect an EAN-8 or EAN-13 barcode from a video frame.
 *
 * @param video - The HTMLVideoElement currently playing the camera stream
 * @param canvas - An offscreen canvas used to grab frames
 * @returns The detected GTIN string, or null if nothing found
 */
export async function detectBarcode(
  video: HTMLVideoElement,
  canvas: OffscreenCanvas,
): Promise<string | null> {
  const w = video.videoWidth
  const h = video.videoHeight
  if (w === 0 || h === 0) return null

  canvas.width = w
  canvas.height = h

  const ctx = canvas.getContext('2d')!
  ctx.drawImage(video, 0, 0, w, h)

  if (await isNativeSupported()) {
    // Native can detect directly from ImageBitmap for best perf
    const bitmap = await createImageBitmap(canvas)
    try {
      return await detectWithNative(bitmap)
    } finally {
      bitmap.close()
    }
  }

  // Fallback: get ImageData for zxing-wasm
  const imageData = ctx.getImageData(0, 0, w, h)
  return detectWithZxing(imageData)
}
