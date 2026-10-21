"use client";

export function PrintButton() {
  return <button className="btn small primary" onClick={() => window.print()}>Print or save as PDF</button>;
}
