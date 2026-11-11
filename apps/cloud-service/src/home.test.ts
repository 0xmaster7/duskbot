import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { BOAT_IMAGE, boatControlScript, boatSetupScript, installCommand, RESTORE_COMMAND, ROLLBACK_COMMAND, startCommand } from "./home.ts";
import { PINNED_RELEASE_KEYS } from "./release-signing.ts";

const sha = (text: string) => createHash("sha256").update(text).digest("hex");

// hashes of what Boat machines ran before the host layer existed: a second host must not change one byte of it
it("Boat's setup, control script and commands are byte for byte what they were", () => {
  expect(sha(boatSetupScript())).toBe("2034f206f60f684089664fd14b814d640f9534ca19cfc62b2a19af4fa2846dfc");
  expect(sha(boatSetupScript({ releaseKeys: PINNED_RELEASE_KEYS, requireSigned: true }))).toBe("4dbd75c7b3c455507140e2f4b1b5a00394aaf8010cfeb09f522c71fa4d31e2d1");
  expect(sha(boatControlScript())).toBe("688b48db75469d8348cb0980780db872a7a7d006f68b775f868353e77ac60575");
  expect(sha(boatControlScript({ releaseKeys: PINNED_RELEASE_KEYS, requireSigned: true }))).toBe("3eace5cbdce69e9507c518ec0fc1f02a5788caf4f7bd5adc3e724a0b010a2836");
  expect(sha(installCommand("a".repeat(64), "https://example.test/p.tgz"))).toBe("788a41259f7baf0efdcaa7890a031d02baa885bc04f876bcdf90d7d97309929e");
  expect(sha(startCommand("https://a.example.test", "https://b.example.test"))).toBe("faec92ff94adc9547dc550562a7f599604f20c3cf9e56d0cafaa31493cf74327");
  expect(sha(RESTORE_COMMAND)).toBe("cbe032a348f4d87dfb05a7c7c0d95022245cbc18159572363406a5605d7ed5da");
  expect(sha(ROLLBACK_COMMAND)).toBe("24e8e4768094363c09e61d7ae6cd2e73aa5fd294626abfbeac0fc98bda911fbe");
  expect([BOAT_IMAGE.homeVolume, BOAT_IMAGE.packagePath, BOAT_IMAGE.restorePath]).toEqual(["__system__/data", "/home/user/omb-home.tgz", "/home/user/omb-restore.tar"]);
});
