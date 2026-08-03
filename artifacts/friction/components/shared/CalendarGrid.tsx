import React, { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from "react-native";
import { Feather } from "@expo/vector-icons";
import { Colors, Typography } from "@/constants/tokens";

/**
 * Shared month-grid calendar primitives.
 *
 * IMPORTANT: cells are rendered with plain RN `Pressable` (or plain `View` for
 * read-only cells), never per-cell Reanimated shared values. A month grid has
 * up to ~42 cells; mounting that many independent `useSharedValue` /
 * `useAnimatedStyle` instances at once (e.g. one `ScalePressable` per cell)
 * is what produced the garbled/blank first paint this component was built to
 * fix. Do not reintroduce per-cell Reanimated animations here — see
 * `.agents/skills/calendar-date-picker/SKILL.md` for the full writeup.
 */

export const WEEKDAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"];

export function buildMonthGrid(year: number, month: number): (Date | null)[] {
  const firstDay = new Date(year, month, 1);
  const startDow = firstDay.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (Date | null)[] = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function startOfDay(d: Date): Date {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

/** Number of days from today a space's start date must be, at minimum. */
export const MIN_SPACE_START_OFFSET_DAYS = 3;

/**
 * Earliest selectable "시작 예정일" (space start date) — today + 3 days,
 * normalized to midnight. Shared by the 공간 만들기 (space-create) and
 * 공간 시작하기 (of-space-start) date pickers so the constraint stays in
 * sync across both flows.
 */
export function getMinSpaceStartDate(referenceDate: Date = new Date()): Date {
  const d = startOfDay(referenceDate);
  d.setDate(d.getDate() + MIN_SPACE_START_OFFSET_DAYS);
  return d;
}

interface CalendarGridCellState {
  isSun: boolean;
  isDisabled: boolean;
}

export interface CalendarGridProps {
  year: number;
  month: number;
  onPrevMonth: () => void;
  onNextMonth: () => void;
  canGoPrev?: boolean;
  canGoNext?: boolean;
  /** Provide to make date cells pressable. Omit for a read-only (review) grid. */
  onSelectDate?: (date: Date) => void;
  isDateDisabled?: (date: Date) => boolean;
  /** Content rendered inside each date cell (day number, badges, etc). */
  renderCellContent: (date: Date, state: CalendarGridCellState) => React.ReactNode;
  /** Extra style applied to a date cell's outer container (e.g. selection highlight). */
  cellContainerStyle?: (date: Date, state: CalendarGridCellState) => StyleProp<ViewStyle>;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * A single reusable month calendar: month-nav header, weekday header, and a
 * 7-column date grid. Selection/read-only behavior and per-cell content are
 * fully controlled by the caller via props so this one implementation can
 * back a selectable date picker as well as a read-only schedule review.
 */
export function CalendarGrid({
  year,
  month,
  onPrevMonth,
  onNextMonth,
  canGoPrev = true,
  canGoNext = true,
  onSelectDate,
  isDateDisabled,
  renderCellContent,
  cellContainerStyle,
  style,
  testID,
}: CalendarGridProps) {
  const cells = useMemo(() => buildMonthGrid(year, month), [year, month]);

  return (
    <View style={[styles.card, style]} testID={testID}>
      <View style={styles.monthNav}>
        <Pressable
          hitSlop={8}
          disabled={!canGoPrev}
          onPress={onPrevMonth}
          style={({ pressed }) => [
            styles.monthNavBtn,
            pressed && canGoPrev && styles.monthNavBtnPressed,
            !canGoPrev && styles.monthNavBtnDisabled,
          ]}
        >
          <Feather name="chevron-left" size={18} color={canGoPrev ? Colors.zinc600 : Colors.zinc300} />
        </Pressable>
        <Text style={styles.monthTitle}>
          {year}년 {month + 1}월
        </Text>
        <Pressable
          hitSlop={8}
          disabled={!canGoNext}
          onPress={onNextMonth}
          style={({ pressed }) => [
            styles.monthNavBtn,
            pressed && canGoNext && styles.monthNavBtnPressed,
            !canGoNext && styles.monthNavBtnDisabled,
          ]}
        >
          <Feather name="chevron-right" size={18} color={canGoNext ? Colors.zinc600 : Colors.zinc300} />
        </Pressable>
      </View>

      <View style={styles.weekRow}>
        {WEEKDAY_LABELS.map((label, i) => (
          <Text key={i} style={[styles.weekLabel, i === 0 && styles.sunLabel]}>
            {label}
          </Text>
        ))}
      </View>

      <View style={styles.grid}>
        {cells.map((date, idx) => {
          if (!date) return <View key={`empty-${idx}`} style={styles.cell} />;

          const isSun = date.getDay() === 0;
          const isDisabled = isDateDisabled?.(date) ?? false;
          const content = renderCellContent(date, { isSun, isDisabled });
          const extraStyle = cellContainerStyle?.(date, { isSun, isDisabled });
          const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;

          if (!onSelectDate) {
            return (
              <View key={key} style={[styles.cell, extraStyle]}>
                {content}
              </View>
            );
          }

          return (
            <Pressable
              key={key}
              disabled={isDisabled}
              onPress={() => onSelectDate(date)}
              style={({ pressed }) => [
                styles.cell,
                extraStyle,
                pressed && !isDisabled && styles.cellPressed,
              ]}
            >
              {content}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export interface CollapsibleDatePickerProps {
  value: Date;
  onChange: (date: Date) => void;
  isDateDisabled?: (date: Date) => boolean;
  /** Bounds for month navigation. Defaults to unbounded. */
  canGoPrevMonth?: (viewYear: number, viewMonth: number) => boolean;
  canGoNextMonth?: (viewYear: number, viewMonth: number) => boolean;
  formatButtonLabel: (date: Date) => string;
  /**
   * Called when the grid is about to open. Return a Date to replace the
   * current selection (e.g. snap an invalid/past value to tomorrow); the
   * returned date is committed via `onChange` and used for the initial
   * visible month. Return nothing to keep the current value.
   */
  onOpen?: () => Date | void;
  triggerIcon?: React.ComponentProps<typeof Feather>["name"];
  /** Collapse the grid again once a date is picked. Defaults to true. */
  closeOnSelect?: boolean;
  triggerStyle?: StyleProp<ViewStyle>;
  triggerTextStyle?: StyleProp<TextStyle>;
  calendarStyle?: StyleProp<ViewStyle>;
}

/**
 * A date field that shows the current selection as plain text by default and
 * only reveals the month grid when tapped, matching the "발송 예정일" pattern.
 * Use this instead of always-mounted inline calendars.
 */
export function CollapsibleDatePicker({
  value,
  onChange,
  isDateDisabled,
  canGoPrevMonth,
  canGoNextMonth,
  formatButtonLabel,
  onOpen,
  triggerIcon = "calendar",
  closeOnSelect = true,
  triggerStyle,
  triggerTextStyle,
  calendarStyle,
}: CollapsibleDatePickerProps) {
  const [open, setOpen] = useState(false);
  const [viewYear, setViewYear] = useState(() => value.getFullYear());
  const [viewMonth, setViewMonth] = useState(() => value.getMonth());

  const handleToggle = () => {
    if (!open) {
      // Re-sync the visible month to the current selection each time it opens,
      // allowing the caller to replace an invalid selection first.
      let target = value;
      const replacement = onOpen?.();
      if (replacement) {
        onChange(replacement);
        target = replacement;
      }
      setViewYear(target.getFullYear());
      setViewMonth(target.getMonth());
    }
    setOpen((prev) => !prev);
  };

  const canGoPrev = canGoPrevMonth ? canGoPrevMonth(viewYear, viewMonth) : true;
  const canGoNext = canGoNextMonth ? canGoNextMonth(viewYear, viewMonth) : true;

  const handlePrevMonth = () => {
    if (!canGoPrev) return;
    if (viewMonth === 0) {
      setViewYear((y) => y - 1);
      setViewMonth(11);
    } else {
      setViewMonth((m) => m - 1);
    }
  };

  const handleNextMonth = () => {
    if (!canGoNext) return;
    if (viewMonth === 11) {
      setViewYear((y) => y + 1);
      setViewMonth(0);
    } else {
      setViewMonth((m) => m + 1);
    }
  };

  return (
    <View>
      <Pressable
        onPress={handleToggle}
        style={({ pressed }) => [styles.trigger, triggerStyle, pressed && styles.triggerPressed]}
      >
        <Feather name={triggerIcon} size={14} color={Colors.zinc500} />
        <Text style={[styles.triggerText, triggerTextStyle]}>{formatButtonLabel(value)}</Text>
        <Feather name={open ? "chevron-up" : "chevron-down"} size={14} color={Colors.zinc400} />
      </Pressable>

      {open && (
        <View style={styles.calendarWrap}>
          <CalendarGrid
            style={calendarStyle}
            year={viewYear}
            month={viewMonth}
            onPrevMonth={handlePrevMonth}
            onNextMonth={handleNextMonth}
            canGoPrev={canGoPrev}
            canGoNext={canGoNext}
            isDateDisabled={isDateDisabled}
            onSelectDate={(date) => {
              onChange(date);
              if (closeOnSelect) setOpen(false);
            }}
            renderCellContent={(date, { isSun, isDisabled }) => {
              const isSelected = isSameDay(date, value);
              return (
                <Text
                  style={[
                    styles.dayNum,
                    isSun && styles.sunDay,
                    isSelected && styles.dayNumSelected,
                    isDisabled && styles.dayNumDisabled,
                  ]}
                >
                  {date.getDate()}
                </Text>
              );
            }}
            cellContainerStyle={(date) => isSameDay(date, value) && styles.cellSelected}
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.zinc200,
    backgroundColor: Colors.white,
    overflow: "hidden",
  },
  monthNav: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.zinc100,
  },
  monthNavBtn: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
  },
  monthNavBtnPressed: {
    backgroundColor: Colors.zinc100,
  },
  monthNavBtnDisabled: {
    opacity: 0.4,
  },
  monthTitle: {
    ...Typography.bodySemiBold,
    fontSize: 14,
    color: Colors.zinc800,
  },
  weekRow: {
    flexDirection: "row",
    backgroundColor: Colors.zinc50,
    borderBottomWidth: 1,
    borderBottomColor: Colors.zinc100,
  },
  weekLabel: {
    flex: 1,
    textAlign: "center",
    paddingVertical: 5,
    ...Typography.caption,
    fontSize: 11,
    color: Colors.zinc500,
  },
  sunLabel: {
    color: "#ef4444",
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  cell: {
    width: `${100 / 7}%` as any,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 8,
  },
  cellPressed: {
    backgroundColor: Colors.zinc50,
  },
  cellSelected: {
    backgroundColor: Colors.zinc900,
    borderRadius: 22,
  },
  dayNum: {
    ...Typography.body,
    fontSize: 13,
    color: Colors.zinc700,
  },
  dayNumSelected: {
    color: Colors.white,
    fontWeight: "600",
  },
  sunDay: {
    color: "#ef4444",
  },
  dayNumDisabled: {
    color: Colors.zinc300,
  },
  trigger: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 11,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.zinc200,
    backgroundColor: Colors.zinc50,
  },
  triggerPressed: {
    backgroundColor: Colors.zinc100,
  },
  triggerText: {
    ...Typography.body,
    fontSize: 14,
    color: Colors.zinc700,
    flex: 1,
  },
  calendarWrap: {
    marginTop: 8,
  },
});
