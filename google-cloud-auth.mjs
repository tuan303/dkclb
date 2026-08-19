import { getVercelOidcToken } from "@vercel/oidc";
import { GoogleAuth, IdentityPoolClient } from "google-auth-library";

const CLOUD_PLATFORM_SCOPE = "https://www.googleapis.com/auth/cloud-platform";
const SHEETS_READONLY_SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";
const SUBJECT_TOKEN_TYPE = "urn:ietf:params:oauth:token-type:jwt";
const TOKEN_URL = "https://sts.googleapis.com/v1/token";

function required(value) {
  return String(value || "").trim();
}

export function createGoogleCloudAuth(config = {}) {
  const projectNumber = required(config.projectNumber);
  const poolId = required(config.poolId);
  const providerId = required(config.providerId);
  const serviceAccountEmail = required(config.serviceAccountEmail);
  const workloadIdentityConfigured = Boolean(projectNumber && poolId && providerId && serviceAccountEmail);
  const scopes = [CLOUD_PLATFORM_SCOPE, SHEETS_READONLY_SCOPE];
  const defaultAuth = workloadIdentityConfigured ? null : new GoogleAuth({ scopes });
  let externalClient = null;

  function getExternalClient() {
    if (!workloadIdentityConfigured) return null;
    if (!externalClient) {
      const audience = `//iam.googleapis.com/projects/${projectNumber}/locations/global/workloadIdentityPools/${poolId}/providers/${providerId}`;
      externalClient = new IdentityPoolClient({
        type: "external_account",
        audience,
        subject_token_type: SUBJECT_TOKEN_TYPE,
        token_url: TOKEN_URL,
        service_account_impersonation_url: `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${encodeURIComponent(serviceAccountEmail)}:generateAccessToken`,
        scopes,
        subject_token_supplier: {
          getSubjectToken: () => getVercelOidcToken(),
        },
      });
    }
    return externalClient;
  }

  async function getClient() {
    return getExternalClient() || defaultAuth.getClient();
  }

  return {
    mode: workloadIdentityConfigured ? "vercel-workload-identity" : "application-default-credentials",
    workloadIdentityConfigured,
    getRuntimeOidcToken: () => getVercelOidcToken(),
    getClient,
  };
}
