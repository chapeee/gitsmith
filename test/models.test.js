import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_MODEL_ID,
  MODEL_REGISTRY,
  getModelById,
  resolveModelSelection
} from "../src/ai/models.js";

test("model registry contains expected default model", () => {
  const model = getModelById(DEFAULT_MODEL_ID);
  assert.ok(model);
  assert.equal(model.id, DEFAULT_MODEL_ID);
});

test("resolveModelSelection prioritizes override model", () => {
  const override = MODEL_REGISTRY[1].id;
  const result = resolveModelSelection(DEFAULT_MODEL_ID, DEFAULT_MODEL_ID, override);
  assert.equal(result.model.id, override);
  assert.equal(result.resolvedFrom, "override");
});

test("resolveModelSelection falls back to default for unknown model", () => {
  const result = resolveModelSelection("does-not-exist", "", "");
  assert.equal(result.model.id, DEFAULT_MODEL_ID);
  assert.equal(result.resolvedFrom, "default");
  assert.match(result.warning, /Unknown model/);
});
