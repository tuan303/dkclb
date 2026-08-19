import { ConfidentialClientApplication, CryptoProvider } from "@azure/msal-node";
import { randomBytes } from "node:crypto";

const OIDC_SCOPES = ["openid", "profile", "email"];

function authError(status, code, message, cause) {
  const error = new Error(message, { cause });
  Object.assign(error, { status, code });
  return error;
}

function normalizeDomain(value) {
  return String(value || "").trim().toLowerCase().replace(/^@/, "");
}

export function isAllowedSchoolIdentity({ email, tenantId }, { allowedDomain, expectedTenantId }) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const domain = normalizeDomain(allowedDomain);
  return Boolean(
    normalizedEmail.endsWith(`@${domain}`)
    && String(tenantId || "").toLowerCase() === String(expectedTenantId || "").toLowerCase(),
  );
}

export function createMicrosoftAuth(config) {
  const clientAssertion = typeof config.clientAssertion === "function" || typeof config.clientAssertion === "string"
    ? config.clientAssertion
    : null;
  const normalized = {
    tenantId: String(config.tenantId || "").trim(),
    clientId: String(config.clientId || "").trim(),
    clientSecret: String(config.clientSecret || "").trim(),
    redirectUri: String(config.redirectUri || "").trim(),
    allowedDomain: normalizeDomain(config.allowedDomain || "hoangmaistarschool.edu.vn"),
  };
  const configured = Boolean(normalized.tenantId && normalized.clientId && (normalized.clientSecret || clientAssertion) && normalized.redirectUri);
  const client = configured ? new ConfidentialClientApplication({
    auth: {
      clientId: normalized.clientId,
      authority: `https://login.microsoftonline.com/${encodeURIComponent(normalized.tenantId)}`,
      ...(normalized.clientSecret ? { clientSecret: normalized.clientSecret } : { clientAssertion }),
    },
  }) : null;
  const cryptoProvider = new CryptoProvider();

  function ensureConfigured() {
    if (!configured) {
      throw authError(503, "MICROSOFT_SSO_NOT_CONFIGURED", "Đăng nhập Microsoft 365 chưa được cấu hình đầy đủ trên backend.");
    }
  }

  return {
    getStatus() {
      return {
        configured,
        allowedDomain: normalized.allowedDomain,
        redirectUri: normalized.redirectUri,
      };
    },

    async createAuthorizationRequest() {
      ensureConfigured();
      const state = randomBytes(32).toString("hex");
      const nonce = randomBytes(32).toString("hex");
      const { verifier, challenge } = await cryptoProvider.generatePkceCodes();
      const url = await client.getAuthCodeUrl({
        scopes: OIDC_SCOPES,
        redirectUri: normalized.redirectUri,
        responseMode: "query",
        state,
        nonce,
        codeChallenge: challenge,
        codeChallengeMethod: "S256",
        prompt: "select_account",
      });
      return { url, state, nonce, codeVerifier: verifier };
    },

    async exchangeCode({ code, state, nonce, codeVerifier }) {
      ensureConfigured();
      let result;
      try {
        result = await client.acquireTokenByCode({
          code,
          scopes: OIDC_SCOPES,
          redirectUri: normalized.redirectUri,
          codeVerifier,
          state,
        });
      } catch (error) {
        throw authError(401, "MICROSOFT_SSO_FAILED", "Microsoft 365 không xác thực được tài khoản. Vui lòng đăng nhập lại.", error);
      }

      const claims = result?.idTokenClaims || {};
      if (!claims.nonce || claims.nonce !== nonce) {
        throw authError(401, "MICROSOFT_NONCE_INVALID", "Phiên đăng nhập Microsoft 365 không hợp lệ hoặc đã hết hạn.");
      }
      const email = String(claims.preferred_username || claims.email || result?.account?.username || "").trim().toLowerCase();
      if (!isAllowedSchoolIdentity({ email, tenantId: claims.tid }, { allowedDomain: normalized.allowedDomain, expectedTenantId: normalized.tenantId })) {
        throw authError(403, "SCHOOL_ACCOUNT_REQUIRED", `Chỉ tài khoản Microsoft 365 thuộc @${normalized.allowedDomain} trong tenant của trường được phép truy cập.`);
      }
      const objectId = String(claims.oid || result?.account?.localAccountId || "").trim();
      if (!objectId) throw authError(401, "MICROSOFT_IDENTITY_MISSING", "Microsoft 365 không trả về mã định danh người dùng hợp lệ.");
      return {
        objectId,
        email,
        name: String(claims.name || email.split("@")[0]).trim(),
        tenantId: String(claims.tid),
      };
    },
  };
}
