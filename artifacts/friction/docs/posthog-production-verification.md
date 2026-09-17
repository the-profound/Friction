# PostHog production delivery verification

## Reverification result (September 17, 2026)

No token values were read or printed. Replit reports both
`EXPO_PUBLIC_POSTHOG_TOKEN` and `EXPO_PUBLIC_POSTHOG_HOST` as present secrets.
The local release gate and resolved Expo configuration passed for every release
profile:

| Build profile | Release track | Local sanitized fingerprint | Local gate |
| --- | --- | --- | --- |
| `test` | `production` | `d0a0e4c276117173` | passed |
| `preview` | `preview` | `26ecdc714cb87103` | passed |
| `development` | `development` | `0889979680bbac77` | passed |

The matching EAS Cloud environments were then inspected through `eas env:exec`.
The cloud gate failed before fingerprint comparison:

| EAS environment | Result |
| --- | --- |
| `production` | Missing `EXPO_PUBLIC_POSTHOG_TOKEN` and `EXPO_PUBLIC_POSTHOG_HOST` |
| `preview` | Missing all five required release variables, including both PostHog variables |
| `development` | Missing all five required release variables, including both PostHog variables |

The five required variables are `EXPO_PUBLIC_SUPABASE_URL`,
`EXPO_PUBLIC_SUPABASE_ANON_KEY`, `EXPO_PUBLIC_DOMAIN`,
`EXPO_PUBLIC_POSTHOG_TOKEN`, and `EXPO_PUBLIC_POSTHOG_HOST`.

Because no matching EAS environment currently passes the pre-build gate, there
is no newly built iOS or Android target carrying the re-registered PostHog
configuration. Device initialization, connectivity, explicit probe flush, and
PostHog Live Events receipt therefore remain blocked rather than failed.
Release builds stop before compilation while required variables are absent or
while the PostHog host is not a root HTTPS URL.

## Owner action required

An owner with Expo/EAS environment access must copy the existing release
variables into each EAS environment used by these profiles. At minimum,
`production` needs the two PostHog variables; `preview` and `development` need
all five required release variables.

| Build profile | EAS environment | Release track |
| --- | --- | --- |
| `test` | `production` | `production` |
| `preview` | `preview` | `preview` |
| `development` | `development` | `development` |

Do not paste the token into source files, logs, task comments, or this document.

## Repeatable verification

1. Run `bash scripts/validate-eas-cloud-env.sh test`,
   `bash scripts/validate-eas-cloud-env.sh preview`, and
   `bash scripts/validate-eas-cloud-env.sh development` from the Friction
   artifact directory. Successful output contains only the release track and a
   non-reversible configuration fingerprint. It must match the corresponding
   local fingerprint in the table above.
2. Build the desired iOS and Android profile through the existing publish
   workflow. The EAS post-install hook validates configuration before the native
   build, and the on-success hook checks the compiled bundle.
3. Install and open the resulting build on a physical device. Filter device logs
   for `[PostHog diagnostic]`.
4. Confirm `kind: initialized`, followed by
   `kind: delivery_probe_flushed`. A failure instead reports one of
   `missing_configuration`, `constructor_failure`, `network_failure`, or
   `flush_failure`. Diagnostics contain only the host and token fingerprint.
5. In the PostHog project matching that token fingerprint, open Live Events and
   filter for `$friction_delivery_probe`. Match `release_track` and
   `configuration_fingerprint` to the device log and validated build output.
   Record only the release track, fingerprints, platform, and receipt time;
   never copy the token or user properties into this document.
6. Repeat once on iOS and once on Android for the target profile.

An explicit flush proving that the SDK accepted the local delivery attempt does
not by itself prove server receipt. Step 5 requires the project owner's PostHog
access, and steps 3 and 6 require target devices.