"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

const noop = () => () => {};

type Detector = { detect: (src: HTMLVideoElement) => Promise<Array<{ rawValue: string }>> };

/**
 * A text field for codes. Handheld scanners type into it like a keyboard. On devices whose browser
 * supports barcode detection (Chrome on Android tablets), a camera button scans QR and barcodes.
 */
export function ScanField({ id, name, label, hint, autoFocus }: { id: string; name: string; label: string; hint?: string; autoFocus?: boolean }) {
  // Server render says "no camera"; the browser checks for barcode support after hydration.
  const supported = useSyncExternalStore(
    noop,
    () => "BarcodeDetector" in window,
    () => false,
  );
  const [scanning, setScanning] = useState(false);
  const [problem, setProblem] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const video = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (!scanning) return;
    let stream: MediaStream | null = null;
    let raf = 0;
    let stopped = false;
    (async () => {
      try {
        const Ctor = (window as unknown as { BarcodeDetector: new (o: { formats: string[] }) => Detector }).BarcodeDetector;
        const detector = new Ctor({ formats: ["qr_code", "code_128", "code_39", "ean_13", "upc_a", "data_matrix"] });
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (!video.current) return;
        video.current.srcObject = stream;
        await video.current.play();
        const tick = async () => {
          if (stopped || !video.current) return;
          const found = await detector.detect(video.current).catch(() => []);
          if (found[0]?.rawValue && input.current) {
            input.current.value = found[0].rawValue;
            setScanning(false);
            return;
          }
          raf = requestAnimationFrame(tick);
        };
        tick();
      } catch {
        setProblem("The camera isn't available. Type the code instead.");
        setScanning(false);
      }
    })();
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [scanning]);

  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="row" style={{ flexWrap: "nowrap" }}>
        <input ref={input} id={id} name={name} autoComplete="off" autoCapitalize="characters" spellCheck={false} autoFocus={autoFocus} aria-describedby={hint ? `${id}-hint` : undefined} />
        {supported && (
          <button type="button" className="btn" onClick={() => setScanning((v) => !v)}>
            {scanning ? "Stop" : "Camera"}
          </button>
        )}
      </div>
      {hint && (
        <span id={`${id}-hint`} className="small muted">
          {hint}
        </span>
      )}
      {scanning && <video ref={video} muted playsInline style={{ width: "100%", maxHeight: 260, borderRadius: 8, background: "#000" }} />}
      {problem && <span className="small error">{problem}</span>}
    </div>
  );
}
