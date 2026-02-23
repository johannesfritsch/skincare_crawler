/**
 * Type declarations for the BarcodeDetector Web API.
 * https://developer.mozilla.org/en-US/docs/Web/API/BarcodeDetector
 */

interface BarcodeDetectorOptions {
  formats: string[]
}

interface DetectedBarcode {
  boundingBox: DOMRectReadOnly
  cornerPoints: Array<{ x: number; y: number }>
  format: string
  rawValue: string
}

declare class BarcodeDetector {
  constructor(options?: BarcodeDetectorOptions)
  static getSupportedFormats(): Promise<string[]>
  detect(source: ImageBitmapSource): Promise<DetectedBarcode[]>
}
