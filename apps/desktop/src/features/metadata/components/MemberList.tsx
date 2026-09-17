import { useRef } from "react";
import { Check } from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";

import styles from "./MemberList.module.css";

/**
 * The class names the list renders with.
 *
 * Passed in rather than fixed, because the retrieve wizard styles its picker
 * from a global stylesheet that the Deployments page must not import — it
 * carries the whole wizard's CSS with it.
 */
export interface MemberListClasses {
  scroll: string;
  viewport: string;
  row: string;
  /** Added to `row` when the member is picked. */
  selected: string;
  check: string;
  name: string;
}

interface MemberListProps {
  members: string[];
  picked: string[];
  onToggle: (member: string) => void;
  classes?: MemberListClasses;
  /**
   * Row height in pixels. Must match whatever the row class sets, or the
   * virtualiser's offsets drift from what is drawn.
   */
  rowHeight?: number;
  /** Names the list for screen readers, e.g. "Apex classes". */
  label?: string;
}

/** Matches both `.mr-comp` in MetadataRetriever.css and `.row` here. */
export const MEMBER_ROW_HEIGHT = 30;

const DEFAULT_CLASSES: MemberListClasses = {
  scroll: styles.scroll,
  viewport: styles.viewport,
  row: styles.row,
  selected: styles.selected,
  check: styles.check,
  name: styles.name,
};

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
  classes = DEFAULT_CLASSES,
  rowHeight = MEMBER_ROW_HEIGHT,
  label,
}: MemberListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const pickedSet = new Set(picked);

  const virtualizer = useVirtualizer({
    count: members.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 15,
  });

  return (
    <div className={classes.scroll} ref={scrollRef}>
      <div
        className={classes.viewport}
        role="group"
        aria-label={label}
        style={{ height: virtualizer.getTotalSize() }}
      >
        {virtualizer.getVirtualItems().map((row) => {
          const member = members[row.index];
          const selected = pickedSet.has(member);
          return (
            <button
              key={row.key}
              type="button"
              className={`${classes.row} ${selected ? classes.selected : ""}`}
              onClick={() => onToggle(member)}
              title={member}
              role="checkbox"
              aria-checked={selected}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                height: rowHeight,
                transform: `translateY(${row.start}px)`,
              }}
            >
              <span className={classes.check} aria-hidden="true">
                {selected && <Check size={12} strokeWidth={3} />}
              </span>
              <span className={classes.name}>{member}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
