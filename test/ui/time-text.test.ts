import { expect, test } from "vitest";
import { ago } from "../../ui/src/ago.js";
import { clockTime } from "../../ui/src/clock-time.js";
import { clockAt } from "../../ui/src/render/clock-at.js";
import { slashBreaks } from "../../ui/src/render/slash-breaks.js";
import { timeAgo } from "../../ui/src/render/time-ago.js";

test.each([Number.NaN, Number.POSITIVE_INFINITY, 1e20, -1e20])("a time of %s never throws and shows —", (at) => {
  expect(ago(at, Date.now())).toBe("—");
  expect(ago(at, Date.now(), "long")).toBe("—");
  expect(clockTime(at, Date.now())).toBe("—");
  expect(timeAgo(at, Date.now()).text).toContain("—");
  expect(clockAt(at, Date.now()).text).toContain("—");
});

test("clock times are 24-hour HH:MM whatever the locale, with the day when it is not today", () => {
  const now = new Date(2026, 10, 2, 23, 0).getTime();
  expect(clockTime(new Date(2026, 10, 2, 7, 43).getTime(), now)).toBe("07:43");
  expect(clockTime(new Date(2026, 10, 2, 19, 5).getTime(), now)).toBe("19:05");
  expect(clockTime(new Date(2026, 10, 1, 14, 2).getTime(), now)).toBe("1 Nov 14:02");
});

test("a ref breaks only after a slash, never inside a part", () => {
  const out = slashBreaks("refs/grove/pins/feat/coupons-model/20261102T021327Z").text;
  expect(out).toContain('<span class="seg">coupons-model</span>');
  expect(out).toContain("/<wbr><span");
  expect(out.split("<wbr>")).toHaveLength(6);
  expect(slashBreaks("<b>/x").text).toContain("&lt;b&gt;");
});

test("a clock time carries its moment, so the clock turns 14:02 into 1 Nov 14:02 after midnight", async () => {
  const { timeLabel } = await import("../../ui/src/time-label.js");
  const at = new Date(2026, 10, 1, 14, 2).getTime();
  const out = clockAt(at, new Date(2026, 10, 1, 23, 0).getTime()).text;
  expect(out).toContain(`data-at="${at}"`);
  expect(out).toContain("data-clock");
  expect(out).toContain(">14:02</time>");
  const data = { at: String(at), clock: "" };
  expect(timeLabel(data, new Date(2026, 10, 1, 23, 59).getTime())).toBe("14:02");
  expect(timeLabel(data, new Date(2026, 10, 2, 0, 1).getTime())).toBe("1 Nov 14:02");
  expect(timeLabel({ at: String(at), ago: "long" }, at + 4 * 60_000)).toBe("4 min ago");
  expect(timeLabel({ at: "nope" }, at)).toBe("—");
});
