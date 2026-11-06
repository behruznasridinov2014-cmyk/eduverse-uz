import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { generateLocalPackage, SUPPORTED_SUBJECTS } from "../src/lib/ai-content.ts";

describe("local AI lesson package generator", () => {
  it("exposes the four focus subjects", () => {
    assert.deepEqual([...SUPPORTED_SUBJECTS].sort(), [
      "biology",
      "chemistry",
      "geography",
      "physics",
    ]);
  });

  it("produces a 40-minute slide deck for every supported subject", () => {
    for (const subject of SUPPORTED_SUBJECTS) {
      const pkg = generateLocalPackage(subject, 7, "Тестовая тема");
      const total = pkg.slides.reduce((sum, slide) => sum + slide.durationMinutes, 0);
      assert.equal(total, 40, `${subject} slides should total 40 minutes`);
      assert.equal(pkg.source, "local");
      assert.ok(pkg.slides.length >= 4);
      assert.ok(pkg.facts.length >= 4);
    }
  });

  it("builds a manipulable 3D object with draggable parts", () => {
    const pkg = generateLocalPackage("geography", 7, "Земля");
    assert.equal(pkg.visual3d.kind, "globe");
    assert.ok(pkg.visual3d.parts.length >= 2);
    assert.ok(pkg.visual3d.parts.some((part) => part.draggable));
    assert.ok(pkg.visual3d.interactions.length >= 2);
  });

  it("uses a cell object for biology and a molecule for chemistry", () => {
    assert.equal(generateLocalPackage("biology", 7, "Клетка").visual3d.kind, "cell");
    assert.equal(generateLocalPackage("chemistry", 7, "Смеси").visual3d.kind, "molecule");
  });

  it("produces a well-formed quiz with exactly one correct answer", () => {
    const pkg = generateLocalPackage("physics", 7, "Движение");
    assert.equal(pkg.quiz.choices.length, 4);
    assert.ok(pkg.quiz.choices.includes(pkg.quiz.correct));
    assert.ok(pkg.quiz.explanation.length > 0);
  });

  it("falls back to geography for an unknown subject name", () => {
    const pkg = generateLocalPackage("astronomy", 7, "Космос");
    assert.equal(pkg.visual3d.kind, "globe");
    assert.equal(pkg.subject, "География");
  });
});
