# PostHog production delivery verification

## Verified configuration state

The EAS `production`, `preview`, and `development` environments were inspected
through `eas env:exec` on September 17, 2026. All three environments are missing:

- `EXPO_PUBLIC_POSTHOG_TOKEN`
- `EXPO_PUBLIC_POSTHOG_HOST`

No token values were read or printed. Release builds now stop before compilation
while either variable is absent or while the host is not a root HTTPS URL.

## Owner action required

An owner with Expo/EAS environment access must add the existing PostHog public
project token and HTTPS ingestion host to each EAS environment used by these
profiles:

| Build profile | EAS environment | Release track |
| --- | --- | --- |
| `test` | `production` | `production` |
| `preview` | `preview` | `preview` |
| `development` | `development` | `development` |

Do not paste the token into source files, logs, task comments, or this document.

## Repeatable verification

1. Run `scripts/validate-eas-cloud-env.sh test`,
   `scripts/validate-eas-cloud-env.sh preview`, and
   `scripts/validate-eas-cloud-env.sh development` from the Friction artifact
   directory. Successful output contains only the release track and a
   non-reversible configuration fingerprint.
2. Build the desired iOS and Android profile through the existing publish
   workflow. The EAS post-install hook validates configuration before the native
   build, and the on-success hook checks the compiled bundle.
3. Install and open the resulting build on a physical device. Filter device logs
   for `[PostHog diagnostic]`.
4. Confirm `kind: initialized`, followed by
   `kind: delivery_probe_flushed`. A failure instead reports one of
   `missing_configuration`, `constructor_failure`, `network_failure`, or
   `flush_failure`. Diagnostics contain only the host and token fingerprint.
5. In the PostHog project matching that fingerprint, open Live Events and filter
   for `$friction_delivery_probe`. Match `release_track` and
   `configuration_fingerprint` to the device log/build output.
6. Repeat once on iOS and once on Android for the target profile.

An explicit flush proving that the SDK accepted the local delivery attempt does
not by itself prove server receipt. Step 5 requires the project owner's PostHog
access, and steps 3 and 6 require target devices.