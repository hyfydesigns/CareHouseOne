import type { ContractPart } from "@/lib/contract-text";

/** "3.1 Price: after the trial…" → the number plain and the label bold, as in the signed copy. */
function Para({ text }: { text: string }) {
  const m = /^(\d+\.\d+ )([A-Z][^:.]{1,60}:)(.*)$/.exec(text);
  if (!m) return <p>{text}</p>;
  return (
    <p>
      {m[1]}
      <b>{m[2]}</b>
      {m[3]}
    </p>
  );
}

/** One part of the Terms of Service / BAA (the same text clients sign with their order form). */
export function LegalPart({ part, level = 1 }: { part: ContractPart; level?: 1 | 2 }) {
  const Title = level === 1 ? "h1" : "h2";
  const Head = level === 1 ? "h2" : "h3";
  const out: React.ReactNode[] = [];
  let items: string[] = [];
  let lead = "";
  const flush = (key: number) => {
    if (!items.length) return;
    // The list after "…may use and disclose PHI only:" is numbered in the original.
    const List = lead.endsWith("only:") ? "ol" : "ul";
    out.push(<List key={`l${key}`}>{items.map((t, i) => <li key={i}>{t}</li>)}</List>);
    items = [];
  };
  part.blocks.forEach((b, i) => {
    if (b.type === "li") return void items.push(b.text);
    flush(i);
    lead = b.type === "p" ? b.text : "";
    if (b.type === "h") out.push(<Head key={i}>{b.text}</Head>);
    else if (b.type === "p") out.push(<Para key={i} text={b.text} />);
    else {
      const [head, ...rows] = b.rows;
      out.push(
        <div key={i} className="site-table">
          <table>
            <thead><tr>{head.map((c) => <th key={c}>{c}</th>)}</tr></thead>
            <tbody>{rows.map((r, j) => <tr key={j}>{r.map((c, k) => <td key={k}>{c}</td>)}</tr>)}</tbody>
          </table>
        </div>,
      );
    }
  });
  flush(part.blocks.length);
  return (
    <>
      <Title id={level === 2 ? part.title.toLowerCase().replace(/[^a-z]+/g, "-") : undefined}>{part.title}</Title>
      {out}
    </>
  );
}
