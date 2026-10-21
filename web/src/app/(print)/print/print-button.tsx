"use client";

/** Prints (or saves as PDF) and records it in the audit log: that's when records leave the app. */
export function PrintButton({ record }: { record: () => Promise<void> }) {
  return (
    <button
      className="btn small primary"
      onClick={() => {
        record().catch(() => {});
        window.print();
      }}
    >
      Print or save as PDF
    </button>
  );
}
