'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { detectBarcode } from '@/lib/barcode'

type ScannerState = 'starting' | 'scanning' | 'detected' | 'error'

interface BarcodeScannerProps {
  open: boolean
  onClose: () => void
  onDetected: (gtin: string) => void
}

export function BarcodeScanner({ open, onClose, onDetected }: BarcodeScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<OffscreenCanvas | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const rafRef = useRef<number>(0)
  const detectedRef = useRef(false)

  const [state, setState] = useState<ScannerState>('starting')
  const [error, setError] = useState<string>('')

  const cleanup = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = 0
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
    detectedRef.current = false
    setState('starting')
  }, [])

  const handleClose = useCallback(() => {
    cleanup()
    onClose()
  }, [cleanup, onClose])

  // Start camera when overlay opens
  useEffect(() => {
    if (!open) return

    let cancelled = false
    detectedRef.current = false

    async function startCamera() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        })

        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }

        streamRef.current = stream

        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play()
          setState('scanning')
        }
      } catch (err) {
        if (cancelled) return
        const msg = err instanceof Error ? err.message : String(err)

        if (msg.includes('Permission') || msg.includes('NotAllowed')) {
          setError('Camera access was denied. Please allow camera access in your browser settings.')
        } else if (msg.includes('NotFound') || msg.includes('DevicesNotFound')) {
          setError('No camera found on this device.')
        } else {
          setError(`Could not start camera: ${msg}`)
        }
        setState('error')
      }
    }

    startCamera()

    return () => {
      cancelled = true
      cleanup()
    }
  }, [open, cleanup])

  // Detection loop
  useEffect(() => {
    if (state !== 'scanning') return

    if (!canvasRef.current) {
      canvasRef.current = new OffscreenCanvas(1, 1)
    }

    let running = true

    async function loop() {
      if (!running || detectedRef.current) return

      const video = videoRef.current
      const canvas = canvasRef.current
      if (!video || !canvas || video.readyState < 2) {
        rafRef.current = requestAnimationFrame(loop)
        return
      }

      try {
        const gtin = await detectBarcode(video, canvas)

        if (gtin && running && !detectedRef.current) {
          detectedRef.current = true
          setState('detected')

          // Haptic feedback
          if (navigator.vibrate) {
            navigator.vibrate(100)
          }

          // Brief delay so user sees the "detected" state.
          // Note: don't gate on `running` here — the effect cleanup sets
          // running=false when state changes to 'detected', which would
          // prevent onDetected from ever firing.
          setTimeout(() => {
            onDetected(gtin)
          }, 400)
          return
        }
      } catch {
        // Detection error on single frame — keep trying
      }

      if (running) {
        rafRef.current = requestAnimationFrame(loop)
      }
    }

    rafRef.current = requestAnimationFrame(loop)

    return () => {
      running = false
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = 0
      }
    }
  }, [state, onDetected])

  // Lock body scroll while open
  useEffect(() => {
    if (!open) return
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = ''
    }
  }, [open])

  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-[100] bg-black flex flex-col">
      {/* Header */}
      <div className="relative z-10 flex items-center justify-between px-4 py-3">
        <span className="text-white/80 text-sm font-medium">
          {state === 'starting' && 'Starting camera...'}
          {state === 'scanning' && 'Point at a barcode'}
          {state === 'detected' && 'Barcode found!'}
          {state === 'error' && 'Camera error'}
        </span>
        <Button
          variant="ghost"
          size="icon"
          onClick={handleClose}
          className="text-white hover:bg-white/10 h-10 w-10"
          aria-label="Close scanner"
        >
          <X className="h-5 w-5" />
        </Button>
      </div>

      {/* Video feed */}
      <div className="flex-1 relative overflow-hidden">
        <video
          ref={videoRef}
          className="absolute inset-0 w-full h-full object-cover"
          playsInline
          muted
        />

        {/* Scan guide overlay */}
        {(state === 'scanning' || state === 'detected') && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            {/* Dimmed edges */}
            <div className="absolute inset-0 bg-black/40" />
            {/* Clear window */}
            <div
              className={`relative w-[280px] h-[160px] sm:w-[360px] sm:h-[200px] rounded-2xl ${
                state === 'detected'
                  ? 'ring-4 ring-green-400'
                  : 'ring-2 ring-white/60'
              } transition-all duration-300`}
              style={{
                boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.4)',
              }}
            >
              {/* Scan line animation */}
              {state === 'scanning' && (
                <div className="absolute inset-x-4 top-1/2 h-0.5 bg-white/70 rounded-full animate-pulse" />
              )}
            </div>
          </div>
        )}

        {/* Error state */}
        {state === 'error' && (
          <div className="absolute inset-0 flex items-center justify-center p-8">
            <div className="text-center">
              <p className="text-white/90 text-sm mb-4">{error}</p>
              <Button variant="secondary" onClick={handleClose}>
                Go back
              </Button>
            </div>
          </div>
        )}

        {/* Loading spinner */}
        {state === 'starting' && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="h-8 w-8 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
