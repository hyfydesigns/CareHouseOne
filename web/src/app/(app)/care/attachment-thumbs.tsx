/* eslint-disable @next/next/no-img-element -- attachments come from an authenticated route that must not be cached or optimised */
import { attachmentUrl, type AttachmentInfo } from "@/server/attachments";

/** A note's photos and documents: thumbnails that open the full file in a new tab. */
export function AttachmentThumbs({ items }: { items: AttachmentInfo[] | undefined }) {
  if (!items?.length) return null;
  return (
    <div className="attach-thumbs">
      {items.map((a) => (
        <a key={a.id} href={attachmentUrl(a)} target="_blank" rel="noreferrer" title={`Open ${a.filename}`}>
          {a.contentType.startsWith("image/") ? <img src={attachmentUrl(a)} alt={a.filename} loading="lazy" /> : <span className="attach-pdf" aria-hidden="true">PDF</span>}
          {!a.contentType.startsWith("image/") && <span className="name">{a.filename}</span>}
        </a>
      ))}
    </div>
  );
}
