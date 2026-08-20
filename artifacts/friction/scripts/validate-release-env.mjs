#!/usr/bin/env node

const required = [
  "EXPO_PUBLIC_SUPABASE_URL",
  "EXPO_PUBLIC_SUPABASE_ANON_KEY",
  "EXPO_PUBLIC_DOMAIN",
];

const invalidPlaceholders = new Set([
  "",
  "placeholder",
  "placeholder-anon-key",
  "configuration-invalid",
  "undefined",
  "null",
]);

function isValidHttpUrl(value) {
  try {
    const url = new URL(value);
    return (
      (url.protocol === "https:" || url.protocol === "http:") &&
      Boolean(url.hostname) &&
      !url.username &&
      !url.password &&
      url.pathname === "/" &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
}

const missing = required.filter((name) => {
  const value = process.env[name]?.trim().toLowerCase() ?? "";
  return invalidPlaceholders.has(value);
});

const invalid = [];
if (process.env.EXPO_PUBLIC_SUPABASE_URL && !isValidHttpUrl(process.env.EXPO_PUBLIC_SUPABASE_URL)) {
  invalid.push("EXPO_PUBLIC_SUPABASE_URL");
}

const domain = process.env.EXPO_PUBLIC_DOMAIN?.trim() ?? "";
if (
  domain.startsWith("/") ||
  !isValidHttpUrl(/^https?:\/\//i.test(domain) ? domain : `https://${domain}`)
) {
  invalid.push("EXPO_PUBLIC_DOMAIN");
}

if (missing.length > 0 || invalid.length > 0) {
  const problems = [...new Set([...missing, ...invalid])];
  console.error(
    `Release configuration is incomplete or invalid: ${problems.join(", ")}.`,
  );
  console.error(
    "Configure these values in the EAS environment and retry. Values are never printed.",
  );
  process.exit(1);
}

console.log(
  "Release configuration validated: Supabase URL, anon key, and API domain are present.",
);