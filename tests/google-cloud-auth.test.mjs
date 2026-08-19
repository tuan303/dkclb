import test from "node:test";
import assert from "node:assert/strict";
import { createGoogleCloudAuth } from "../google-cloud-auth.mjs";

test("uses Vercel Workload Identity only when all Google identifiers are present", () => {
  const local = createGoogleCloudAuth({});
  assert.equal(local.mode, "application-default-credentials");
  assert.equal(local.workloadIdentityConfigured, false);

  const production = createGoogleCloudAuth({
    projectNumber: "810121949696",
    poolId: "vercel",
    providerId: "vercel",
    serviceAccountEmail: "nshm-sheet-reader@dkclb-2626f.iam.gserviceaccount.com",
  });
  assert.equal(production.mode, "vercel-workload-identity");
  assert.equal(production.workloadIdentityConfigured, true);
});
