import { useRef } from "react";
import { Check } from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";

interface MemberListProps {
  members: string[];
  picked: string[];
  onToggle: (member: string) => void;
}

/** Must match `.mr-comp` height in MetadataRetriever.css. */
const ROW_HEIGHT = 30;

/**
 * Virtualised component picker.
 *
 * `CustomField` in a mature org lists well over ten thousand members, and the
 * picker mounted a button for every one of them.
 */
export default function MemberList({
  members,
  picked,
  onToggle,
}: MemberListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const pickedSet = new Set(picked);

  const virtualizer = useVirtualizer({
    count: members.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 15,
  });

  return (
    <div className="mr-comps__scroll" ref={scrollRef}>
      <div
        className="mr-comps__viewport"
        style={{ height: virtualizer.getTotalSize() }}
      >
        {virtualizer.getVirtualItems().map((row) => {
          const member = members[row.index];
          const selected = pickedSet.has(member);
          return (
            <button
              key={row.key}
              type="button"
              className={`mr-comp ${selected ? "is-selected" : ""}`}
              onClick={() => onToggle(member)}
              title={member}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                height: ROW_HEIGHT,
                transform: `translateY(${row.start}px)`,
              }}
            >
              <span className="mr-comp__check">
                {selected && <Check size={12} strokeWidth={3} />}
              </span>
              <span className="mr-comp__name">{member}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
