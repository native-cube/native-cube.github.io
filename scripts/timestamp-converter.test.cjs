"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { parseTimestamp, createZoneFormatter, formatTimestamp, compareTimestamps } = require("../timestamp-converter/timestamp.js");

test("detects common epoch units and respects explicit units for short values", () => {
  assert.deepEqual(parseTimestamp("1735732800.25"), {
    nanoseconds: 1_735_732_800_250_000_000n,
    format: "seconds",
  });
  assert.deepEqual(parseTimestamp("+001735732800250"), {
    nanoseconds: 1_735_732_800_250_000_000n,
    format: "milliseconds",
  });
  assert.equal(parseTimestamp("1000").nanoseconds, 1_000_000_000_000n);
  assert.equal(parseTimestamp("1000", "milliseconds").nanoseconds, 1_000_000_000n);
});

test("converts ISO calendar dates and offsets to exact epoch values", () => {
  const { nanoseconds } = parseTimestamp("2025-01-01T17:30:00.123456789+05:30");
  const result = formatTimestamp(nanoseconds, createZoneFormatter("Asia/Kolkata"));

  assert.equal(result.utc, "2025-01-01T12:00:00.123456789Z");
  assert.equal(result.seconds, "1735732800.123456789");
  assert.equal(result.milliseconds, "1735732800123.456789");
  assert.match(result.zoned, /17:30:00\.123456789 GMT\+05:30$/);
  assert.equal(parseTimestamp(result.seconds, "seconds").nanoseconds, nanoseconds);
  assert.equal(parseTimestamp(result.milliseconds, "milliseconds").nanoseconds, nanoseconds);
  assert.equal(formatTimestamp(parseTimestamp("2024-02-29").nanoseconds).utc, "2024-02-29T00:00:00.000Z");
});

test("preserves negative fractions across the Unix epoch", () => {
  const { nanoseconds } = parseTimestamp("-0.000001", "milliseconds");
  assert.equal(nanoseconds, -1n);
  assert.deepEqual(formatTimestamp(nanoseconds), {
    utc: "1969-12-31T23:59:59.999999999Z",
    zoned: "",
    seconds: "-0.000000001",
    milliseconds: "-0.000001",
  });
  assert.equal(parseTimestamp("1969-12-31T23:59:59.999999999Z").nanoseconds, nanoseconds);
  assert.equal(compareTimestamps(nanoseconds, 0n).cloudWatch, null);
});

test("accepts quoted JSON values and explicit UTC times pasted from logs", () => {
  const expected = parseTimestamp("2025-01-01T12:00:00.250Z").nanoseconds;
  for (const input of [
    JSON.stringify("2025-01-01T12:00:00.250Z"),
    JSON.stringify("1735732800250"),
    "2025-01-01 12:00:00.250 UTC",
    "2025-01-01 17:30:00.250 +0530",
  ]) {
    assert.equal(parseTimestamp(input).nanoseconds, expected);
  }
  assert.throws(() => parseTimestamp("\"timestamp\": \"1735732800250\""), /single timestamp value/);
  assert.throws(() => parseTimestamp(`${"0".repeat(64)}1`), /up to 64 characters/);
});

test("validates calendar fields, time offsets, precision, and the Date range", () => {
  for (const input of ["2025-02-29", "2025-04-31T00:00:00Z", "2025-13-01", "2025-01-00"]) {
    assert.throws(() => parseTimestamp(input), /valid calendar date/);
  }
  assert.throws(() => parseTimestamp("2025-01-01T12:00:00"), /Z, UTC, or an offset/);
  assert.throws(() => parseTimestamp("2025-01-01T12:00:00+05:60"), /valid UTC offset/);
  assert.throws(() => parseTimestamp("2025-01-01T12:00:60Z"), /minutes and seconds/);
  assert.throws(() => parseTimestamp("1735732800.1234567890", "seconds"), /9 fractional digits/);
  assert.throws(() => parseTimestamp("1735732800000.0000001", "milliseconds"), /6 fractional digits/);
  assert.throws(() => parseTimestamp("8640000000000001", "milliseconds"), /supported date range/);
  assert.equal(formatTimestamp(parseTimestamp("+275760-09-13T01:00:00+01:00").nanoseconds).utc, "+275760-09-13T00:00:00.000Z");
});

test("distinguishes repeated local times using the offset at each instant", () => {
  const formatter = createZoneFormatter("America/New_York");
  const a = parseTimestamp("2025-11-02T01:30:00-0400").nanoseconds;
  const b = parseTimestamp("2025-11-02T01:30:00-05:00").nanoseconds;

  assert.match(formatTimestamp(a, formatter).zoned, /01:30:00\.000 GMT-04:00$/);
  assert.match(formatTimestamp(b, formatter).zoned, /01:30:00\.000 GMT-05:00$/);
  assert.equal(compareTimestamps(a, b).duration, "1h");
  assert.throws(() => createZoneFormatter("Invalid/Zone"), RangeError);
});

test("sorts CloudWatch bounds independently of input order", () => {
  const a = parseTimestamp("2025-01-01T12:00:00.250Z").nanoseconds;
  const b = parseTimestamp("1735732930500").nanoseconds;

  assert.deepEqual(compareTimestamps(b, a), {
    earlier: "B",
    duration: "2m 10.25s",
    milliseconds: "130250",
    cloudWatch: { start: "1735732800250", end: "1735732930500", rounded: false },
  });
  assert.equal(compareTimestamps(a, b).earlier, "A");
  assert.deepEqual(compareTimestamps(0n, 0n), {
    earlier: null,
    duration: "0s",
    milliseconds: "0",
    cloudWatch: { start: "0", end: "0", rounded: false },
  });
});

test("widens CloudWatch bounds while keeping the elapsed duration exact", () => {
  assert.deepEqual(compareTimestamps(1_000_001n, 1_000_002n), {
    earlier: "A",
    duration: "0.000000001s",
    milliseconds: "0.000001",
    cloudWatch: { start: "1", end: "2", rounded: true },
  });
});
