import { useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

interface RecordTableProps {
  records: Record<string, unknown>[];
  headers: string[];
  renderCell: (value: unknown) => string;
}

/** Row height in px — must match `.soql-record-table td` line-height + padding. */
const ROW_HEIGHT = 30;

/**
 * Virtualised SOQL results.
 *
 * `sf data query` paginates transparently, so a broad query returns every
 * matching record. Rendering one `<tr>` per record locked the window solid on
 * anything in the tens of thousands; only the visible slice is mounted now.
 */
export default function RecordTable({
  records,
  headers,
  renderCell,
}: RecordTableProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: records.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });

  const rows = virtualizer.getVirtualItems();
  const paddingTop = rows.length > 0 ? rows[0].start : 0;
  const paddingBottom =
    rows.length > 0
      ? virtualizer.getTotalSize() - rows[rows.length - 1].end
      : 0;

  return (
    <div className="soql-records" ref={scrollRef}>
      <table className="soql-record-table">
        <thead>
          <tr>
            {headers.map((key) => (
              <th key={key}>{key}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {/* Spacer rows keep the scrollbar honest without mounting the rows. */}
          {paddingTop > 0 && (
            <tr aria-hidden>
              <td style={{ height: paddingTop, padding: 0, border: 0 }} />
            </tr>
          )}

          {rows.map((row) => {
            const record = records[row.index];
            return (
              <tr key={row.key} data-index={row.index}>
                {headers.map((key) => (
                  <td key={key}>{renderCell(record[key])}</td>
                ))}
              </tr>
            );
          })}

          {paddingBottom > 0 && (
            <tr aria-hidden>
              <td style={{ height: paddingBottom, padding: 0, border: 0 }} />
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
