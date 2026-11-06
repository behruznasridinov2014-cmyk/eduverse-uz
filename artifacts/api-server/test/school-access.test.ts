import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canAccessSchool,
  canManageClass,
  canManageSchool,
  canReviewAssignments,
  canSubmitAssignment,
  cleanText,
  isAssignmentStatus,
  isGlobalAdminRole,
  isReviewableSubmissionStatus,
  isUniqueConstraintViolation,
  isValidUuid,
  parseBoundedInteger,
  parseDueAt,
  parseOptionalScore,
} from "../src/lib/school-access.ts";

describe("school access rules", () => {
  it("accepts only canonical UUIDs", () => {
    assert.equal(isValidUuid("0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f"), true);
    assert.equal(isValidUuid("not-a-uuid"), false);
    assert.equal(isValidUuid("0f0f0f0f-0f0f-6f0f-8f0f-0f0f0f0f0f0f"), false);
    assert.equal(isValidUuid(42), false);
  });

  it("recognises global administrators and school managers separately", () => {
    assert.equal(isGlobalAdminRole("platform_superadmin"), true);
    assert.equal(isGlobalAdminRole("school_director"), false);
    assert.equal(canManageSchool("platform_superadmin", null), true);
    assert.equal(canManageSchool("school_director", "school_director"), true);
    assert.equal(canManageSchool("school_admin", "school_director"), true);
    assert.equal(canManageSchool("teacher", "teacher"), false);
    assert.equal(canAccessSchool("parent", "parent"), true);
    assert.equal(canAccessSchool("parent", null), false);
  });

  it("treats a class teacher as a class manager and reviewer, but not a student", () => {
    assert.equal(canManageClass("teacher", "teacher", "teacher"), true);
    assert.equal(canReviewAssignments("teacher", "teacher", "teacher"), true);
    assert.equal(canSubmitAssignment("student", "student"), true);
    assert.equal(canSubmitAssignment("student", "teacher"), false);
    assert.equal(canSubmitAssignment("teacher", "teacher"), false);
    assert.equal(canManageClass("student", "student", "student"), false);
    assert.equal(canReviewAssignments("student", "student", "student"), false);
  });
});

describe("school request validation", () => {
  it("trims and bounds text fields", () => {
    assert.equal(cleanText("  Grade 7B  "), "Grade 7B");
    assert.equal(cleanText("   "), undefined);
    assert.equal(cleanText("a".repeat(6), 5), undefined);
    assert.equal(cleanText(123), undefined);
  });

  it("parses bounded integers and scores", () => {
    assert.equal(parseBoundedInteger("7", 1, 11), 7);
    assert.equal(parseBoundedInteger(11, 1, 11), 11);
    assert.equal(parseBoundedInteger("12", 1, 11), undefined);
    assert.equal(parseBoundedInteger("7.5", 1, 11), undefined);
    assert.equal(parseOptionalScore(null), null);
    assert.equal(parseOptionalScore(""), null);
    assert.equal(parseOptionalScore("87"), 87);
    assert.equal(parseOptionalScore("101"), undefined);
  });

  it("parses ISO due dates without inventing dates", () => {
    const parsed = parseDueAt("2026-05-20T16:00:00.000Z");
    assert.equal(parsed.ok, true);
    if (parsed.ok) assert.equal(parsed.value?.toISOString(), "2026-05-20T16:00:00.000Z");
    assert.deepEqual(parseDueAt(null), { ok: true, value: null });
    assert.deepEqual(parseDueAt("not a date"), { ok: false });
    assert.deepEqual(parseDueAt(123), { ok: false });
  });

  it("validates assignment and submission statuses", () => {
    assert.equal(isAssignmentStatus("under_review"), true);
    assert.equal(isAssignmentStatus("missing"), false);
    assert.equal(isReviewableSubmissionStatus("checked"), true);
    assert.equal(isReviewableSubmissionStatus("assigned"), false);
  });

  it("finds nested unique constraint violations", () => {
    assert.equal(isUniqueConstraintViolation({ code: "23505" }), true);
    assert.equal(
      isUniqueConstraintViolation({ cause: { cause: { code: "23505" } } }),
      true,
    );
    assert.equal(isUniqueConstraintViolation({ code: "23503" }), false);
    assert.equal(isUniqueConstraintViolation(null), false);
  });
});
