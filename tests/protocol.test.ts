import test from "node:test";
import assert from "node:assert/strict";
import {
  uint,
  key,
  deployments,
  displayId,
  resolveLegacyURL,
  amountLabel,
} from "../packages/protocol/src/index";
test("blockchain IDs and amounts never pass through floating point", () => {
  const huge = "9007199254740993000000001";
  assert.equal(displayId(8453, huge), (BigInt(huge) + 986n).toString());
  assert.equal(resolveLegacyURL("base", displayId(8453, huge)).onChainId, huge);
  assert.equal(resolveLegacyURL("base", "985").deployment.version, 2);
  assert.equal(resolveLegacyURL("base", "986").onChainId, "0");
  assert.equal(resolveLegacyURL("base", "986").deployment.version, 3);
  assert.equal(resolveLegacyURL("arbitrum", "180").onChainId, "0");
  assert.equal(key(8453, deployments[1].address, huge).split(":").at(-1), huge);
  assert.equal(amountLabel("1000000000000000010", 18), "1.00000000000000001");
  assert.throws(() => uint.parse("1.5"));
  assert.throws(() => uint.parse((2n ** 256n).toString()));
});
