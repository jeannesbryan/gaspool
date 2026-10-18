/**
 * Configuration that depends on the deployment.
 *
 * The values here carry defaults so that deployments already running do not
 * change behaviour, but all of them can (and should) be set via `vars`
 * in wrangler.jsonc so that someone else's instance does not point at the
 * original developer's resources.
 */

const DEFAULT_R2_PUBLIC_BASE_URL =
  "https://pub-13cc00374110455e9437c511bcbdf007.r2.dev";

type PublicUrlEnv = { R2_PUBLIC_BASE_URL?: string };

/**
 * Public base URL of the R2 bucket, where route JSON files and radio recordings are served.
 *
 * Set `R2_PUBLIC_BASE_URL` to the public domain of your own bucket. If it is
 * left empty, the value falls back to the developer default and file links will
 * point at the wrong bucket.
 */
export const getR2PublicBaseUrl = (env?: PublicUrlEnv) => {
  const configured = String(env?.R2_PUBLIC_BASE_URL || "").trim();
  return (configured || DEFAULT_R2_PUBLIC_BASE_URL).replace(/\/+$/, "");
};

/** Hostname only, used when comparing the origin of a polyline. */
export const getR2PublicHostname = (env?: PublicUrlEnv) => {
  try {
    return new URL(getR2PublicBaseUrl(env)).hostname;
  } catch {
    return "";
  }
};
