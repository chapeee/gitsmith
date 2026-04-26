import test from "node:test";
import assert from "node:assert/strict";
import { shouldAskForAi } from "../src/commands/commit.js";

const baseConfig = {
  ai: {
    enabled: true,
    askByDefault: true
  }
};

test("shows AI prompt when ai.enabled is true and askByDefault is true", () => {
  assert.equal(shouldAskForAi(baseConfig, "auto"), true);
});

test("--no-ai skips AI gate", () => {
  assert.equal(shouldAskForAi(baseConfig, "off"), false);
});

test("--ai forces AI gate even when askByDefault is false", () => {
  const config = {
    ai: {
      enabled: true,
      askByDefault: false
    }
  };
  assert.equal(shouldAskForAi(config, "force"), true);
});
