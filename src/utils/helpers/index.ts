import { SANDBOX_DB_SCHEMA_PREFIX } from "../constants";

export const SQLSanitiser = (msg: string): string => {
  if (msg?.length < 1) {
    return "An unknown error occurred during SQL execution.";
  }

  const cleaned = msg.replace(
    /assignment_schema_[a-fA-F0-9]{24}/g,
    "assignment",
  );

  if (cleaned.includes("statement timeout")) {
    return "Time Limit Exceeded!";
  }

  if (cleaned.includes("work_mem")) {
    return "Memory Limit Exceeded!";
  }

  if (cleaned.includes("permission denied")) {
    return "Operation not allowed!";
  }

  return cleaned;
};

export const getSandboxDBSchemaIdForAssignment = (seed: string): string =>
  SANDBOX_DB_SCHEMA_PREFIX + seed;

export const compareQueryResults = (
  userRows: Array<Record<string, unknown>>,
  solutionRows: Array<Record<string, unknown>>,
  orderMatters: boolean,
): boolean => {
  if (userRows.length !== solutionRows.length) return false;

  const normalize = (row: Record<string, unknown>) =>
    JSON.stringify(
      Object.keys(row)
        .sort()
        .map((k) => [k, row[k]]),
    );

  const userNormalized = userRows.map(normalize);
  const solutionNormalized = solutionRows.map(normalize);

  if (!orderMatters) {
    userNormalized.sort();
    solutionNormalized.sort();
  }

  return userNormalized.every((row, i) => row === solutionNormalized[i]);
};

export function encodeRedisPassword(uri: string): string {
  const schemeIdx = uri.indexOf("://");
  if (schemeIdx < 0) return uri;
  const prefix = uri.slice(0, schemeIdx + 3);
  const rest = uri.slice(schemeIdx + 3);
  const colonIdx = rest.indexOf(":");
  if (colonIdx < 0) return uri;
  const user = rest.slice(0, colonIdx);
  if (/[\/?#@]/.test(user)) return uri;
  const afterUser = rest.slice(colonIdx + 1);
  let atIdx = -1;
  let hosts = "";
  let suffix = "";
  let searchFrom = 0;
  while (true) {
    const i = afterUser.indexOf("@", searchFrom);
    if (i < 0) break;
    const afterAt = afterUser.slice(i + 1);
    let hostEnd = afterAt.search(/[\/?#]/);
    if (hostEnd < 0) hostEnd = afterAt.length;
    const candidate = afterAt.slice(0, hostEnd);
    if (candidate.length > 0 && /^[A-Za-z0-9.,_:\[\]-]+$/.test(candidate)) {
      atIdx = i;
      hosts = candidate;
      suffix = afterAt.slice(hostEnd);
      break;
    }
    searchFrom = i + 1;
  }
  if (atIdx < 0) return uri;
  const password = afterUser.slice(0, atIdx);
  if (!password) return uri;
  return `${prefix}${user}:${encodeURIComponent(password)}@${hosts}${suffix}`;
}
