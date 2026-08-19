import test from "node:test";
import assert from "node:assert/strict";
import { createMicrosoftAuth, isAllowedSchoolIdentity } from "../microsoft-auth.mjs";

test("school identity requires both the configured tenant and domain", () => {
  const policy = { allowedDomain: "hoangmaistarschool.edu.vn", expectedTenantId: "tenant-123" };
  assert.equal(isAllowedSchoolIdentity({ email: "teacher@hoangmaistarschool.edu.vn", tenantId: "tenant-123" }, policy), true);
  assert.equal(isAllowedSchoolIdentity({ email: "teacher@gmail.com", tenantId: "tenant-123" }, policy), false);
  assert.equal(isAllowedSchoolIdentity({ email: "teacher@hoangmaistarschool.edu.vn", tenantId: "other" }, policy), false);
});

test("reports a safe unconfigured status without exposing secrets", async () => {
  const auth = createMicrosoftAuth({ allowedDomain: "@hoangmaistarschool.edu.vn" });
  assert.deepEqual(auth.getStatus(), { configured: false, allowedDomain: "hoangmaistarschool.edu.vn", redirectUri: "" });
  await assert.rejects(auth.createAuthorizationRequest(), (error) => error.code === "MICROSOFT_SSO_NOT_CONFIGURED");
});

test("accepts a short-lived federated assertion instead of a client secret", () => {
  const auth = createMicrosoftAuth({
    tenantId: "tenant-123",
    clientId: "client-123",
    clientAssertion: async () => "runtime-oidc-token",
    redirectUri: "https://clb.nshm.vn/api/auth/microsoft/callback",
    allowedDomain: "hoangmaistarschool.edu.vn",
  });
  assert.equal(auth.getStatus().configured, true);
});
