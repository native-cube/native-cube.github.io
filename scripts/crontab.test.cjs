"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const cron = require("../crontab/cron.js");

function runs(expression, after, { mode = "linux", zone = "UTC", count = 3 } = {}) {
  return cron.nextRuns(cron.parse(expression, mode), { after, timeZone: zone, count }).runs.map((run) => new Date(run.timestamp).toISOString());
}

test("next matches are strictly after the start, including seconds", () => {
  assert.deepEqual(runs("*/15 * * * *", "2026-11-02T10:15:00Z"), ["2026-11-02T10:30:00.000Z", "2026-11-02T10:45:00.000Z", "2026-11-02T11:00:00.000Z"]);
  assert.equal(runs("* * * * *", "2026-11-02T10:15:01Z")[0], "2026-11-02T10:16:00.000Z");
});

test("steps reset within the field rather than using elapsed durations", () => {
  assert.deepEqual(runs("*/35 * * * *", "2026-11-02T10:00:00Z"), ["2026-11-02T10:35:00.000Z", "2026-11-02T11:00:00.000Z", "2026-11-02T11:35:00.000Z"]);
  assert.deepEqual(runs("20/15 9 * * *", "2026-11-02T09:00:00Z"), ["2026-11-02T09:20:00.000Z", "2026-11-02T09:35:00.000Z", "2026-11-02T09:50:00.000Z"]);
});

test("named ranges, lists, macros, Sunday aliases, and Kubernetes wildcards", () => {
  assert.equal(runs("30 9 * * mon-fri", "2026-11-06T10:00:00Z")[0], "2026-11-09T09:30:00.000Z");
  assert.equal(runs("0 9,17 * * *", "2026-11-02T10:00:00Z")[0], "2026-11-02T17:00:00.000Z");
  assert.equal(cron.parse("@weekly").expression, "0 0 * * 0");
  assert.equal(runs("0 0 * * 7", "2026-11-02T00:00:00Z")[0], "2026-11-08T00:00:00.000Z");
  assert.equal(runs("0 9 ? * MON", "2026-11-02T00:00:00Z", { mode: "kubernetes" })[0], "2026-11-02T09:00:00.000Z");
});

test("restricted day-of-month and weekday fields use OR; wildcard steps use AND", () => {
  assert.deepEqual(runs("0 9 1 * MON", "2026-11-01T00:00:00Z"), ["2026-11-01T09:00:00.000Z", "2026-11-02T09:00:00.000Z", "2026-11-09T09:00:00.000Z"]);
  assert.deepEqual(runs("0 9 */2 * MON", "2026-11-01T00:00:00Z"), ["2026-11-09T09:00:00.000Z", "2026-11-23T09:00:00.000Z", "2026-12-07T09:00:00.000Z"]);
});

test("leap days, impossible dates, and sparse schedules respect the search window", () => {
  assert.deepEqual(runs("0 12 29 FEB *", "2026-01-01T00:00:00Z"), ["2028-02-29T12:00:00.000Z", "2032-02-29T12:00:00.000Z"]);
  assert.deepEqual(runs("0 0 31 FEB *", "2026-01-01T00:00:00Z"), []);
  assert.equal(runs("0 0 29 FEB *", "2096-03-01T00:00:00Z")[0], "2104-02-29T00:00:00.000Z");
});

test("time-zone evaluation is independent of the host zone and handles fractional offsets", () => {
  assert.equal(runs("0 9 * * *", "2026-11-02T00:00:00Z", { zone: "Asia/Kolkata" })[0], "2026-11-02T03:30:00.000Z");
  assert.equal(runs("0 9 * * *", "2026-11-02T00:00:00Z", { zone: "Asia/Kathmandu" })[0], "2026-11-02T03:15:00.000Z");
  assert.equal(runs("0 9 * * *", "2026-11-01T23:00:00Z", { zone: "Pacific/Kiritimati" })[0], "2026-11-02T19:00:00.000Z");
});

test("the horizon ends at the UTC anniversary, including zones ahead of UTC", () => {
  const annual = runs("0 9 1 JAN *", "2026-01-01T00:00:00Z", { count: 10 });
  assert.equal(annual.length, 8);
  assert.equal(annual.at(-1), "2033-01-01T09:00:00.000Z");
  const result = cron.nextRuns(cron.parse("0 9 1 JAN *"), { after: "2026-01-01T00:00:00Z", timeZone: "Pacific/Kiritimati", count: 10 });
  assert.equal(result.runs.at(-1).timestamp, Date.parse("2033-12-31T19:00:00Z"));
  assert.equal(result.until, Date.parse("2034-01-01T00:00:00Z"));
  assert.ok(result.runs.every((run) => run.timestamp < result.until));
});

test("spring-forward gaps are skipped by Linux, Kubernetes, and AWS", () => {
  for (const mode of ["linux", "kubernetes", "aws"]) {
    const expression = mode === "aws" ? "30 2 * * ? *" : "30 2 * * *";
    assert.equal(runs(expression, "2026-03-08T00:00:00Z", { mode, zone: "America/New_York" })[0], "2026-03-09T06:30:00.000Z");
  }
});

test("GitHub missing times advance to the first valid minute; overlaps deduplicate", () => {
  assert.equal(runs("30 2 * * *", "2026-03-08T00:00:00Z", { mode: "github", zone: "America/New_York" })[0], "2026-03-08T07:00:00.000Z");
  assert.deepEqual(runs("0,30 2,3 * * *", "2026-03-08T00:00:00Z", { mode: "github", zone: "America/New_York", count: 2 }), ["2026-03-08T07:00:00.000Z", "2026-03-08T07:30:00.000Z"]);
});

test("fall-back repeats are ordered by UTC; AWS invokes once even when start is in the second fold", () => {
  assert.deepEqual(runs("30 1 * * *", "2026-11-01T00:00:00Z", { zone: "America/New_York" }), ["2026-11-01T05:30:00.000Z", "2026-11-01T06:30:00.000Z", "2026-11-02T06:30:00.000Z"]);
  assert.equal(runs("30 1 * * *", "2026-11-01T05:45:00Z", { zone: "America/New_York" })[0], "2026-11-01T06:30:00.000Z");
  assert.equal(runs("30 1 * * ? *", "2026-11-01T05:45:00Z", { mode: "aws", zone: "America/New_York" })[0], "2026-11-02T06:30:00.000Z");
});

test("half-hour clock changes work without assuming one-hour DST", () => {
  assert.deepEqual(runs("45 1 * * *", "2026-04-04T12:00:00Z", { zone: "Australia/Lord_Howe", count: 2 }), ["2026-04-04T14:45:00.000Z", "2026-04-04T15:15:00.000Z"]);
});

test("AWS supports year constraints, question marks, and distinct Sunday numbering", () => {
  assert.equal(runs("cron(0 9 ? * 1 2027)", "2026-11-02T00:00:00Z", { mode: "aws" })[0], "2027-01-03T09:00:00.000Z");
  assert.deepEqual(runs("0 0 1 JAN ? 2025", "2026-11-02T00:00:00Z", { mode: "aws" }), []);
});

test("AWS last day and nearest weekdays stay within the calendar month", () => {
  assert.deepEqual(runs("0 9 L * ? *", "2026-01-01T00:00:00Z", { mode: "aws" }), ["2026-01-31T09:00:00.000Z", "2026-02-28T09:00:00.000Z", "2026-03-31T09:00:00.000Z"]);
  assert.equal(runs("0 9 1W AUG ? 2026", "2026-01-01T00:00:00Z", { mode: "aws" })[0], "2026-08-03T09:00:00.000Z");
  assert.equal(runs("0 9 31W MAY ? 2026", "2026-01-01T00:00:00Z", { mode: "aws" })[0], "2026-05-29T09:00:00.000Z");
  assert.deepEqual(runs("0 9 31W FEB ? *", "2026-01-01T00:00:00Z", { mode: "aws" }), []);
});

test("AWS nth and last weekdays include absent fifth weekdays and bare L", () => {
  assert.equal(runs("0 9 ? * MON#2 *", "2026-01-01T00:00:00Z", { mode: "aws" })[0], "2026-01-12T09:00:00.000Z");
  assert.equal(runs("0 9 ? * FRIL *", "2026-01-01T00:00:00Z", { mode: "aws" })[0], "2026-01-30T09:00:00.000Z");
  assert.equal(runs("0 9 ? * MON#5 *", "2026-02-01T00:00:00Z", { mode: "aws" })[0], "2026-03-30T09:00:00.000Z");
  assert.equal(runs("0 9 ? * L *", "2026-01-01T00:00:00Z", { mode: "aws" })[0], "2026-01-03T09:00:00.000Z");
});

test("invalid or unsupported syntax fails clearly rather than being approximated", () => {
  for (const expression of ["", "0 0 * *", "0 0 * * * *", "60 * * * *", "0 24 * * *", "0 0 0 * *", "0 0 * 13 *", "*/0 * * * *", "*/-1 * * * *", "1,,2 * * * *", "9-2 * * * *", "0 0 * * FUNDAY", "0 0 L * *", "@reboot", "TZ=UTC 0 0 * * *", "0 0 * * * echo hello"]) {
    assert.throws(() => cron.parse(expression), Error, expression);
  }
  for (const mode of ["kubernetes", "github"]) assert.throws(() => cron.parse("0 0 * * 7", mode));
  assert.throws(() => cron.parse("@daily", "github"), /macros/);
  for (const expression of ["0 0 * * * *", "0 0 ? * ? *", "0 0 ? * 0 *", "0 0 1 * ? 2200", "0 0 ? * MON#6 *", "0 0 ? * MON#1,TUE#2 *", "0 0 LW * ? *", "0 0 ? * */2 *"]) {
    assert.throws(() => cron.parse(expression, "aws"), Error, expression);
  }
  assert.throws(() => cron.parse("* ".repeat(300)));
  assert.throws(() => cron.parse("0 0 * * *", "unknown"));
});

test("invalid dates, zones, and unbounded preview requests fail clearly", () => {
  const schedule = cron.parse("0 0 * * *");
  assert.throws(() => cron.nextRuns(schedule, { timeZone: "Not/AZone" }), /time zone/);
  assert.throws(() => cron.nextRuns(schedule, { after: "invalid" }), /date/);
  assert.throws(() => cron.nextRuns(schedule, { count: 100000 }));
  assert.throws(() => cron.nextRuns(schedule, { years: 1000 }));
});

test("exports keep scheduler fields and zone settings separate", () => {
  assert.match(cron.snippet(cron.parse("@daily", "kubernetes"), "Europe/London"), /schedule: "0 0 \* \* \*"\n  timeZone: "Europe\/London"/);
  assert.match(cron.snippet(cron.parse("30 9 * * MON", "github"), "Asia/Kolkata"), /timezone: "Asia\/Kolkata"/);
  const aws = JSON.parse(cron.snippet(cron.parse("0 9 ? * MON *", "aws"), "America/New_York"));
  assert.equal(aws.ScheduleExpression, "cron(0 9 ? * MON *)");
  assert.equal(aws.ScheduleExpressionTimezone, "America/New_York");
  assert.equal(aws.FlexibleTimeWindow.Mode, "OFF");
});
