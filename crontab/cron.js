/* Cron parsing and wall-clock evaluation. No DOM, network, or host-zone dependency. */
"use strict";

const CronScheduleBuilder = (() => {
  const minuteMs = 60000;
  const dayMs = 86400000;
  const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  const weekdays = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
  const aliases = {
    "@yearly": "0 0 1 1 *",
    "@annually": "0 0 1 1 *",
    "@monthly": "0 0 1 * *",
    "@weekly": "0 0 * * 0",
    "@daily": "0 0 * * *",
    "@midnight": "0 0 * * *",
    "@hourly": "0 * * * *",
  };
  const modes = {
    linux: { name: "Linux cron", count: 5, sunday: 0, weekdayMax: 7 },
    kubernetes: { name: "Kubernetes CronJob", count: 5, sunday: 0, weekdayMax: 6 },
    github: { name: "GitHub Actions", count: 5, sunday: 0, weekdayMax: 6 },
    aws: { name: "AWS EventBridge Scheduler", count: 6, sunday: 1, weekdayMax: 7 },
  };

  function definitions(mode) {
    const platform = modes[mode];
    if (!platform) throw new Error("Choose a supported scheduler.");
    const fields = [
      { name: "Minute", min: 0, max: 59 },
      { name: "Hour", min: 0, max: 23 },
      { name: "Day of month", min: 1, max: 31 },
      { name: "Month", min: 1, max: 12, names: months, nameStart: 1 },
      { name: "Day of week", min: platform.sunday, max: platform.weekdayMax, names: weekdays, nameStart: platform.sunday },
    ];
    if (mode === "aws") fields.push({ name: "Year", min: 1970, max: 2199 });
    return fields;
  }

  function number(value, definition) {
    const named = definition.names?.indexOf(value) ?? -1;
    const parsed = named >= 0 ? named + definition.nameStart : /^\d+$/.test(value) ? Number(value) : NaN;
    if (!Number.isInteger(parsed) || parsed < definition.min || parsed > definition.max) {
      throw new Error(`${definition.name}: use ${definition.min}–${definition.max}${definition.names ? ` or ${definition.names[0]}–${definition.names.at(-1)}` : ""}.`);
    }
    return parsed;
  }

  function parseField(raw, definition, mode, index) {
    const values = new Set();
    const field = { ...definition, raw, values, wildcard: false, special: null };
    if (mode === "aws" && (index === 2 || index === 4)) {
      if (raw === "?") return { ...field, wildcard: true };
      if (index === 2 && raw === "L") return { ...field, special: { type: "last-day" } };
      if (index === 2 && /^\d+W$/.test(raw)) {
        return { ...field, special: { type: "weekday", day: number(raw.slice(0, -1), definition) } };
      }
      if (index === 4 && raw === "L") raw = "7";
      const special = index === 4 && raw.match(/^(\d+|[A-Z]{3})(L|#[1-5])$/);
      if (special) {
        return { ...field, special: { type: special[2] === "L" ? "last-weekday" : "nth-weekday", day: number(special[1], definition) - 1, nth: Number(special[2].slice(1)) } };
      }
    }
    if (mode === "aws" && index === 4 && raw.includes("/")) {
      throw new Error("Day of week: AWS supports lists, ranges, L, and #; put increments in another field.");
    }
    const parts = raw.split(",");
    field.wildcard = mode === "kubernetes"
      ? parts.some((part) => /^[*?]/.test(part))
      : raw.startsWith("*");
    for (const part of parts) {
      const stepParts = part.split("/");
      if (!part || stepParts.length > 2 || (stepParts.length === 2 && !/^\d+$/.test(stepParts[1]))) {
        throw new Error(`${definition.name}: use a value, list, range, or positive step such as */2.`);
      }
      const step = stepParts.length === 2 ? Number(stepParts[1]) : 1;
      if (step < 1 || step > definition.max - definition.min + 1) {
        throw new Error(`${definition.name}: step must be between 1 and ${definition.max - definition.min + 1}.`);
      }
      const base = stepParts[0];
      let start;
      let end;
      if (base === "*" || (base === "?" && mode === "kubernetes")) {
        start = definition.min;
        end = definition.max;
      } else {
        const range = base.split("-");
        if (range.length > 2) throw new Error(`${definition.name}: ranges must look like 1-5.`);
        start = number(range[0], definition);
        end = range.length === 2 ? number(range[1], definition) : stepParts.length === 2 ? definition.max : start;
        if (start > end) throw new Error(`${definition.name}: range start must not exceed its end. Split a wrapping range into a list.`);
      }
      for (let value = start; value <= end; value += step) values.add(index === 4 && mode === "linux" && value === 7 ? 0 : value);
    }
    return field;
  }

  function parse(expression, mode = "linux") {
    const defs = definitions(mode);
    let source = expression.trim().toUpperCase();
    if (source.length > 512) throw new Error("Keep the expression under 512 characters.");
    if (source.startsWith("@")) {
      if (mode !== "linux" && mode !== "kubernetes") throw new Error(`${modes[mode].name} requires numeric fields, not @ macros.`);
      source = aliases[source.toLowerCase()];
      if (!source) throw new Error("Use @hourly, @daily, @weekly, @monthly, or @yearly. @reboot has no predictable next execution.");
    }
    if (mode === "aws" && /^CRON\(/.test(source) && source.endsWith(")")) source = source.slice(5, -1).trim();
    const parts = source ? source.split(/\s+/) : [];
    if (parts.length !== defs.length) {
      throw new Error(`${modes[mode].name} needs ${defs.length} fields: minute, hour, day of month, month, day of week${mode === "aws" ? ", year" : ""}. Paste only the schedule, without a command or seconds field.`);
    }
    if (mode === "aws" && ((parts[2] === "?") === (parts[4] === "?"))) {
      throw new Error("AWS requires exactly one of day of month or day of week to be ?. For daily runs use: 0 9 * * ? *.");
    }
    const fields = parts.map((part, index) => parseField(part, defs[index], mode, index));
    return { mode, fields, expression: parts.join(" ") };
  }

  function dateMatches(schedule, date) {
    const [year, month, day] = date;
    const fields = schedule.fields;
    if (!fields[3].values.has(month) || (fields[5] && !fields[5].values.has(year))) return false;
    const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    let dom = fields[2].values.has(day);
    const special = fields[2].special;
    if (special?.type === "last-day") dom = day === lastDay;
    if (special?.type === "weekday" && special.day <= lastDay) {
      const wanted = new Date(Date.UTC(year, month - 1, special.day)).getUTCDay();
      let nearest = special.day;
      if (wanted === 6) nearest += special.day === 1 ? 2 : -1;
      if (wanted === 0) nearest += special.day === lastDay ? -2 : 1;
      dom = day === nearest;
    }
    const weekSpecial = fields[4].special;
    let dow = fields[4].values.has(weekday + modes[schedule.mode].sunday);
    if (weekSpecial) {
      dow = weekday === weekSpecial.day && (weekSpecial.type === "last-weekday" ? day + 7 > lastDay : Math.ceil(day / 7) === weekSpecial.nth);
    }
    if (schedule.mode === "aws") return fields[2].raw === "?" ? dow : dom;
    return fields[2].wildcard || fields[4].wildcard ? dom && dow : dom || dow;
  }

  function createClock(timeZone) {
    let formatter;
    try {
      formatter = new Intl.DateTimeFormat("en-GB-u-ca-gregory-nu-latn", {
        timeZone, year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
      });
    } catch {
      throw new Error("Enter a valid IANA time zone, such as Europe/London or America/New_York.");
    }
    function parts(timestamp) {
      const result = {};
      for (const part of formatter.formatToParts(timestamp)) if (part.type !== "literal") result[part.type] = Number(part.value);
      return [result.year, result.month, result.day, result.hour, result.minute, result.second];
    }
    function wall(timestamp) {
      const [year, month, day, hour, minute, second] = parts(timestamp);
      return Date.UTC(year, month - 1, day, hour, minute, second);
    }
    return { parts, wall, offset: (timestamp) => wall(timestamp) - timestamp };
  }

  // Evaluate calendar days, then resolve wall times against the offsets around
  // that day. This handles half-hour offsets and DST folds without scanning
  // millions of UTC minutes for sparse annual schedules.
  function nextRuns(schedule, { timeZone = "UTC", after = Date.now(), count = 10, years = 8 } = {}) {
    const start = Number(new Date(after));
    if (!Number.isFinite(start)) throw new Error("Choose a valid preview start date.");
    if (!Number.isInteger(count) || count < 1 || count > 100) throw new Error("Preview count must be between 1 and 100.");
    if (!Number.isInteger(years) || years < 1 || years > 8) throw new Error("Search horizon must be between 1 and 8 years.");
    const clock = createClock(timeZone);
    const [year, month, day] = clock.parts(start);
    const firstDay = Date.UTC(year, month - 1, day);
    const anniversary = new Date(start);
    anniversary.setUTCFullYear(anniversary.getUTCFullYear() + years);
    const end = anniversary.getTime();
    const hours = [...schedule.fields[1].values].sort((a, b) => a - b);
    const minutes = [...schedule.fields[0].values].sort((a, b) => a - b);
    const runs = [];
    for (let date = firstDay; date < end + dayMs && runs.length < count; date += dayMs) {
      const calendar = new Date(date);
      if (!dateMatches(schedule, [calendar.getUTCFullYear(), calendar.getUTCMonth() + 1, calendar.getUTCDate()])) continue;
      const offsets = [...new Set([-dayMs, 0, dayMs, dayMs * 2].map((delta) => clock.offset(date + delta)))];
      const candidates = new Map();
      for (const hour of hours) {
        for (const minute of minutes) {
          const wall = date + hour * 60 * minuteMs + minute * minuteMs;
          let instants = offsets.map((offset) => wall - offset).filter((instant) => clock.wall(instant) === wall).sort((a, b) => a - b);
          let note = "";
          if (!instants.length && schedule.mode === "github") {
            // GitHub advances a missing wall time to the first valid minute.
            const upper = Math.max(...offsets.map((offset) => wall - offset));
            let low = Math.min(...offsets.map((offset) => wall - offset));
            let high = upper;
            while (high - low > minuteMs) {
              const middle = Math.floor((low + high) / 2 / minuteMs) * minuteMs;
              if (clock.wall(middle) < wall) low = middle;
              else high = middle;
            }
            if (clock.wall(high) >= wall && clock.wall(high) < date + dayMs) {
              instants = [high];
              note = "Advanced past a daylight-saving gap";
            }
          }
          if (instants.length > 1) {
            if (schedule.mode === "aws" || schedule.mode === "github") instants = instants.slice(0, 1);
            note = "Repeated local time at a clock change";
          }
          for (const instant of instants) {
            if (instant > start && instant < end) candidates.set(instant, { timestamp: instant, offset: clock.offset(instant) / minuteMs, note });
          }
        }
      }
      runs.push(...[...candidates.values()].sort((a, b) => a.timestamp - b.timestamp).slice(0, count - runs.length));
    }
    return { runs, until: end };
  }

  function fieldDescription(field, index, mode) {
    if (field.raw === "?") return mode === "aws" ? "Not specified; the other day field applies" : "Every value";
    if (field.special) {
      const special = field.special;
      if (special.type === "last-day") return "Last day of the month";
      if (special.type === "weekday") return `Weekday nearest day ${special.day} (within the month)`;
      return `${special.type === "last-weekday" ? "Last" : ["", "First", "Second", "Third", "Fourth", "Fifth"][special.nth]} ${weekdays[special.day]} of the month`;
    }
    const all = index === 4 && mode === "linux" ? 7 : field.max - field.min + 1;
    if (field.values.size === all) return `Every ${["minute", "hour", "day of month", "month", "day of week", "year"][index]}`;
    const step = field.raw.match(/^\*\/(\d+)$/);
    if (step) return `Every ${step[1]} ${["minutes", "hours", "days", "months", "weekdays", "years"][index]}, starting at ${field.min}`;
    const values = [...field.values].sort((a, b) => a - b);
    const labels = values.map((value) => index === 3 ? months[value - 1] : index === 4 ? weekdays[value - modes[mode].sunday] : String(value));
    return labels.length > 12 ? `${labels.slice(0, 10).join(", ")} … (${labels.length} values)` : labels.join(", ");
  }

  function explain(schedule) {
    const [minute, hour, dom, month, dow, year] = schedule.fields;
    let text;
    if (minute.values.size === 1 && hour.values.size === 1) {
      text = `At ${String([...hour.values][0]).padStart(2, "0")}:${String([...minute.values][0]).padStart(2, "0")}`;
    } else if (minute.raw === "*" && hour.raw === "*") text = "Every minute";
    else if (/^\*\/\d+$/.test(minute.raw) && hour.raw === "*") text = `Every ${minute.raw.slice(2)} minutes within each hour`;
    else if (minute.values.size === 1 && hour.raw === "*") text = `At minute ${[...minute.values][0]} of every hour`;
    else text = `Minutes ${fieldDescription(minute, 0, schedule.mode)}; hours ${fieldDescription(hour, 1, schedule.mode)}`;
    const domActive = !dom.wildcard;
    const dowActive = !dow.wildcard;
    if (schedule.mode === "aws") {
      const active = dom.raw === "?" ? dow : dom;
      if (active.raw !== "*") text += ` · ${dom.raw === "?" ? "on" : "day"} ${fieldDescription(active, dom.raw === "?" ? 4 : 2, schedule.mode)}`;
    } else if (domActive && dowActive) text += ` · on day ${fieldDescription(dom, 2, schedule.mode)} OR ${fieldDescription(dow, 4, schedule.mode)}`;
    else {
      if (dom.raw !== "*" && dom.raw !== "?") text += ` · day ${fieldDescription(dom, 2, schedule.mode)}`;
      if (dow.raw !== "*" && dow.raw !== "?") text += ` · on ${fieldDescription(dow, 4, schedule.mode)}`;
    }
    if (month.raw !== "*") text += ` · in ${fieldDescription(month, 3, schedule.mode)}`;
    if (year && year.raw !== "*") text += ` · ${fieldDescription(year, 5, schedule.mode)}`;
    return text;
  }

  function snippet(schedule, timeZone) {
    const expression = schedule.expression;
    const zone = JSON.stringify(timeZone);
    if (schedule.mode === "aws") return JSON.stringify({ ScheduleExpression: `cron(${expression})`, ScheduleExpressionTimezone: timeZone, FlexibleTimeWindow: { Mode: "OFF" } }, null, 2);
    if (schedule.mode === "github") return `name: Scheduled task\non:\n  schedule:\n    - cron: "${expression}"\n      timezone: ${zone}\n  workflow_dispatch:\npermissions:\n  contents: read\njobs:\n  scheduled-task:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo "Replace with your task"\n`;
    if (schedule.mode === "kubernetes") return `apiVersion: batch/v1\nkind: CronJob\nmetadata:\n  name: scheduled-task\nspec:\n  schedule: "${expression}"\n  timeZone: ${zone}\n  concurrencyPolicy: Forbid\n  successfulJobsHistoryLimit: 3\n  failedJobsHistoryLimit: 1\n  jobTemplate:\n    spec:\n      template:\n        spec:\n          restartPolicy: Never\n          containers:\n            - name: task\n              image: busybox:stable\n              command: ["/bin/sh", "-c", "date; echo Replace with your task"]\n`;
    return `# For Cronie-compatible cron implementations supporting CRON_TZ.\nCRON_TZ=${timeZone}\n${expression} /path/to/your-command\n`;
  }

  return { modes, definitions, parse, dateMatches, createClock, nextRuns, explain, fieldDescription, snippet };
})();

if (typeof module !== "undefined" && module.exports) module.exports = CronScheduleBuilder;
