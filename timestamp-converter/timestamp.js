"use strict";

const TimestampConverter = (() => {
  const nanosecondsPerSecond = 1_000_000_000n;
  const nanosecondsPerMillisecond = 1_000_000n;
  const dateLimit = 8_640_000_000_000_000n * nanosecondsPerMillisecond;
  const numericPattern = /^(?<sign>[+-]?)(?<whole>\d+)(?:\.(?<fraction>\d+))?$/;
  const isoPattern = /^(?<year>\d{4}|[+-]\d{6})-(?<month>\d{2})-(?<day>\d{2})(?:[T ](?<hour>\d{2}):(?<minute>\d{2})(?::(?<second>\d{2})(?:\.(?<fraction>\d{1,9}))?)?[ \t]*(?<offset>Z|UTC|[+-]\d{2}:?\d{2}))?$/i;

  function parseNumber({ sign, whole, fraction = "" }, format) {
    const digits = format === "seconds" ? 9 : 6;
    if (fraction.length > digits) {
      throw new RangeError(`Unix ${format} supports up to ${digits} fractional digits.`);
    }
    const nanoseconds = BigInt(`${whole}${fraction.padEnd(digits, "0")}`);
    return sign === "-" ? -nanoseconds : nanoseconds;
  }

  function parseIso(text) {
    const parts = isoPattern.exec(text)?.groups;
    if (!parts) {
      throw new RangeError("Use YYYY-MM-DD or a date and time with Z, UTC, or an offset such as +05:30.");
    }

    const { year, month, day, hour = "00", minute = "00", second = "00", fraction = "", offset = "Z" } = parts;
    const numericYear = Number(year);
    const leap = numericYear % 4 === 0 && (numericYear % 100 !== 0 || numericYear % 400 === 0);
    const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (year === "-000000" || Number(day) < 1 || !(Number(day) <= daysInMonth[Number(month) - 1])) {
      throw new RangeError("Enter a valid calendar date.");
    }
    if (Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) {
      throw new RangeError("Use hours 00–23 and minutes and seconds 00–59.");
    }

    const zone = offset.toUpperCase().replace(/^UTC$/, "Z").replace(/^([+-]\d{2})(\d{2})$/, "$1:$2");
    if (zone !== "Z" && (Number(zone.slice(1, 3)) > 23 || Number(zone.slice(-2)) > 59)) {
      throw new RangeError("Enter a valid UTC offset, for example +05:30.");
    }
    const milliseconds = Date.parse(`${year}-${month}-${day}T${hour}:${minute}:${second}${zone}`);
    if (!Number.isFinite(milliseconds)) throw new RangeError("This instant is outside the supported date range.");
    return BigInt(milliseconds) * nanosecondsPerMillisecond + BigInt(fraction.padEnd(9, "0"));
  }

  function parseTimestamp(input, format = "auto") {
    let text = input.trim();
    if (text.length > 64) throw new RangeError("Enter a timestamp of up to 64 characters.");
    if (text.startsWith("\"")) {
      try {
        text = JSON.parse(text).trim();
      } catch {
        throw new RangeError("Paste a single timestamp value from the JSON document.");
      }
    }
    if (!text) throw new RangeError("Enter a timestamp.");

    const number = numericPattern.exec(text)?.groups;
    if (format === "auto") {
      const whole = number?.whole.replace(/^0+(?=\d)/, "");
      format = number ? (whole.length >= 12 ? "milliseconds" : "seconds") : "iso";
    }

    let nanoseconds;
    if (format === "iso") {
      nanoseconds = parseIso(text);
    } else {
      if (!number) throw new RangeError(`Enter Unix ${format} as a plain number, for example ${format === "seconds" ? "1735732800.25" : "1735732800250"}.`);
      nanoseconds = parseNumber(number, format);
    }
    if (nanoseconds < -dateLimit || nanoseconds > dateLimit) {
      throw new RangeError("This instant is outside the supported date range.");
    }
    return { nanoseconds, format };
  }

  function decimal(nanoseconds, places) {
    const negative = nanoseconds < 0n;
    const absolute = negative ? -nanoseconds : nanoseconds;
    const scale = 10n ** BigInt(places);
    const fraction = (absolute % scale).toString().padStart(places, "0").replace(/0+$/, "");
    return `${negative ? "-" : ""}${absolute / scale}${fraction ? `.${fraction}` : ""}`;
  }

  function createZoneFormatter(timeZone) {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone,
      calendar: "gregory",
      year: "numeric",
      era: "short",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
      timeZoneName: "longOffset",
    });
  }

  function formatTimestamp(nanoseconds, zoneFormatter) {
    // Date formats the whole second. Keep the fractional part exact, including before 1970.
    const remainder = nanoseconds % nanosecondsPerSecond;
    const fraction = remainder < 0n ? remainder + nanosecondsPerSecond : remainder;
    const seconds = new Date(Number((nanoseconds - fraction) / nanosecondsPerMillisecond));
    const digits = fraction.toString().padStart(9, "0").replace(/0+$/, "").padEnd(3, "0");
    const utc = seconds.toISOString().replace(".000Z", `.${digits}Z`);

    let zoned = "";
    if (zoneFormatter) {
      const parts = Object.fromEntries(zoneFormatter.formatToParts(seconds).map(({ type, value }) => [type, value]));
      const era = parts.era === "BC" ? " BC" : "";
      zoned = `${parts.day} ${parts.month} ${parts.year}${era}, ${parts.hour}:${parts.minute}:${parts.second}.${digits} ${parts.timeZoneName}`;
    }
    return { utc, zoned, seconds: decimal(nanoseconds, 9), milliseconds: decimal(nanoseconds, 6) };
  }

  function formatDuration(nanoseconds) {
    const parts = [];
    for (const [seconds, unit] of [[86_400n, "d"], [3_600n, "h"], [60n, "m"]]) {
      const size = seconds * nanosecondsPerSecond;
      if (nanoseconds < size) continue;
      parts.push(`${nanoseconds / size}${unit}`);
      nanoseconds %= size;
    }
    if (nanoseconds || !parts.length) parts.push(`${decimal(nanoseconds, 9)}s`);
    return parts.join(" ");
  }

  function compareTimestamps(a, b) {
    const first = a <= b ? a : b;
    const last = a <= b ? b : a;
    const elapsed = last - first;
    let cloudWatch = null;

    if (first >= 0n) {
      const endFraction = last % nanosecondsPerMillisecond;
      // Widen the inclusive CloudWatch range to whole milliseconds when needed.
      cloudWatch = {
        start: (first / nanosecondsPerMillisecond).toString(),
        end: (last / nanosecondsPerMillisecond + (endFraction ? 1n : 0n)).toString(),
        rounded: first % nanosecondsPerMillisecond !== 0n || endFraction !== 0n,
      };
    }

    return {
      earlier: a === b ? null : a < b ? "A" : "B",
      duration: formatDuration(elapsed),
      milliseconds: decimal(elapsed, 6),
      cloudWatch,
    };
  }

  return { parseTimestamp, createZoneFormatter, formatTimestamp, compareTimestamps };
})();

if (typeof module !== "undefined" && module.exports) module.exports = TimestampConverter;
