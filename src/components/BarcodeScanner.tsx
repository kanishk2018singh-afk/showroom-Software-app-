/**
 * BarcodeScanner — camera se scan (jahan browser support de) +
 * USB/Bluetooth scanner (keyboard-type) ke liye input box.
 *
 * Note: USB/Bluetooth scanner koi app nahi maangta — wo keyboard ki tarah
 * type karta hai, isliye billing screen ka code box hi kaam kar jata hai.
 * Camera scan ke liye BarcodeDetector API (Chrome/Android) chahiye.
 */
import { useEffect, useRef, useState } from 'react'
import { Button, Modal } from './ui'
import { beep, vibrate } from '../lib/util'

interface DetectedBarcode {
  rawValue: string
}
interface BarcodeDetectorLike {
  detect: (source: CanvasImageSource) => Promise<DetectedBarcode[]>
}
interface BarcodeDetectorCtor {
  new (options?: { formats?: string[] }): BarcodeDetectorLike
  getSupportedFormats?: () => Promise<string[]>
}

function getDetectorCtor(): BarcodeDetectorCtor | undefined {
  return (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector
}

export function BarcodeScanner({ open, onClose, onDetect }: { open: boolean; onClose: () => void; onDetect: (code: string) => void }) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [error, setError] = useState('')
  const [manual, setManual] = useState('')
  const supported = typeof window !== 'undefined' && !!getDetectorCtor()

  useEffect(() => {
    if (!open) return
    let stream: MediaStream | undefined
    let raf = 0
    let stopped = false

    const start = async () => {
      if (!supported) return
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play().catch(() => undefined)
        }
        const detector = new (getDetectorCtor() as BarcodeDetectorCtor)({
          formats: ['ean_13', 'ean_8', 'code_128', 'code_39', 'upc_a', 'upc_e', 'qr_code', 'itf'],
        })
        const tick = async () => {
          if (stopped || !videoRef.current) return
          try {
            const found = await detector.detect(videoRef.current)
            const code = found[0]?.rawValue
            if (code) {
              beep(980, 80)
              vibrate(30)
              onDetect(code)
              onClose()
              return
            }
          } catch {
            /* frame skip */
          }
          raf = requestAnimationFrame(() => void tick())
        }
        void tick()
      } catch (e) {
        setError((e as Error).message || 'Camera nahi khul paya — permission check karein')
      }
    }

    void start()
    return () => {
      stopped = true
      cancelAnimationFrame(raf)
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [open, onDetect, onClose, supported])

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Barcode scan"
      footer={
        <div className="space-y-2">
          <div className="flex gap-2">
            <input
              value={manual}
              onChange={(e) => setManual(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && manual.trim()) {
                  beep(980, 70)
                  onDetect(manual.trim())
                  setManual('')
                  onClose()
                }
              }}
              placeholder="Scanner se code type karein (Enter dabayein)"
              className="flex-1 rounded-xl border border-slate-300 px-3 py-2 text-sm"
              autoFocus={!supported}
            />
            <Button
              onClick={() => {
                if (!manual.trim()) return
                onDetect(manual.trim())
                setManual('')
                onClose()
              }}
            >
              OK
            </Button>
          </div>
          <p className="text-[11px] text-slate-500">
            USB/Bluetooth scanner chalane ke liye bas bill screen ke code box me scan karein — alag se kuch setup nahi chahiye.
          </p>
        </div>
      }
    >
      {supported ? (
        <div className="space-y-2">
          <div className="overflow-hidden rounded-2xl bg-black">
            <video ref={videoRef} className="h-64 w-full object-cover" muted playsInline />
          </div>
          {error ? (
            <div className="rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</div>
          ) : (
            <p className="text-center text-xs text-slate-500">Barcode ko frame ke andar rakhein…</p>
          )}
        </div>
      ) : (
        <div className="rounded-xl bg-amber-50 px-3 py-3 text-xs text-amber-800">
          Is browser me camera-scan support nahi hai (Chrome/Android me chalta hai). Neeche box me code type karein ya
          USB/Bluetooth scanner se seedha bill screen par scan karein.
        </div>
      )}
    </Modal>
  )
}
