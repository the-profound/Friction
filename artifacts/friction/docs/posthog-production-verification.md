# PostHog release delivery verification

## Development verification result (September 18, 2026 KST)

**Final classification: build and configuration are valid; iOS device delivery
and PostHog server receipt are not yet confirmed.**

No token values were read or printed. The intended development release
configuration has the following sanitized settings:

| Target | Result |
| --- | --- |
| Build profile / release track | `development` / `development` |
| PostHog host | `us.i.posthog.com` |
| PostHog token fingerprint | `32d2d8eaae570a8c` |
| Configuration fingerprint | `0889979680bbac77` |

### Latest corrected recheck and build

On September 18, 2026 KST, the actual
`@team-theprofound/friction-dev` project-scoped `development` environment
passed the corrected preflight:

- all five required public variable names were present;
- release track was `development`;
- configuration fingerprint was `0889979680bbac77`.

After the development-client bundle check was corrected, iOS development build
37 (`a9b55b1b-fcb0-4500-9774-717d9fbbadab`) completed successfully on September
18, 2026 KST. EAS reports:

- project `@team-theprofound/friction-dev`;
- profile `development`, platform iOS, distribution `STORE`;
- build number `37`;
- source commit `7a9226278b97cccf16163f8a19d6fc89a365e3e1`;
- completed application archive;
- no build error.

The publish workflow scheduled TestFlight submission
`72f23487-90b0-4075-b62c-c8d19a687fc2`. At the time of this verification the
workflow was still waiting for an available Apple submitter, so submission
completion was not yet confirmed.

The current Expo web development logs show PostHog `initialized` and
`delivery_probe_flushed` with token fingerprint `32d2d8eaae570a8c`. These are
web/Metro diagnostics, not evidence from build 37 on an iOS device. No build-37
iOS device diagnostic or matching PostHog Live Events receipt was available.

The current classification is therefore **app build and PostHog configuration
verified, but iOS device transmission and server receipt unconfirmed**.

### Earlier build 36 failure

The development-only iOS workflow previously created build 36
(`c651d9df-c93e-4c04-9b26-fb11a8fcea7e`). EAS confirmed project
`@team-theprofound/friction-dev`, profile `development`, platform iOS, and
loaded the five required public variables from the `development` environment.
No general iOS or Android release workflow was run.

Build 36 reached native compilation, then ended with status `ERRORED` in the
Build success hook. The configured success hook runs
`validate-eas-bundle.mjs`, which requires a native JavaScript bundle. A
development client receives JavaScript from Metro rather than embedding a
release bundle, so this check is not compatible with this build shape. The
workflow stopped before its completion output and TestFlight submission.

Because build 36 was not submitted or installed:

- there is no build-36 iOS `initialized` diagnostic;
- there is no build-36 iOS `delivery_probe_flushed` diagnostic;
- there is no eligible build-36 `$friction_delivery_probe` to match in PostHog
  Live Events.

That failure was the Build success hook, not the PostHog configuration, and was
resolved before build 37.

The original `validate-eas-cloud-env.sh development` check reported fingerprint
`0889979680bbac77`, but that result was a false positive: the script did not set
`EAS_BUILD_PROFILE=development` until after EAS CLI had resolved the Expo
project. It therefore checked the general Friction project's `development`
environment instead of the separate `friction-dev` project used by development
builds.

The validator now sets the profile before EAS resolves the project, and its
regression test asserts that project-selection context.

The first corrected check against the actual development project
(`@team-theprofound/friction-dev`, project ID ending `bfb7f9ff`) found all five
required release variables absent. Build 35 below records the resulting remote
failure.

The new iOS development build 35
(`aceeeb5a-88a2-43c7-be74-f3b097c7fd1f`) was created on September 18 KST for
the correct `friction-dev` project and `development` profile. It failed in the
remote `Read app config` phase. The build worker received `APP_VARIANT` and
`APP_RELEASE_TRACK`, but none of the five public release variables above. The
post-install and bundle success hooks were never reached.

Because a new development bundle was not produced:

- the EAS bundle success hook could not verify a compiled development bundle;
- there is no new dev-app `initialized` or `delivery_probe_flushed` diagnostic;
- there is no eligible `$friction_delivery_probe` to match in PostHog Live
  Events.

The local Metro web preview did report `initialized` and
`delivery_probe_flushed` with token fingerprint `32d2d8eaae570a8c`. This proves
the local web SDK accepted a flush; it is not evidence from the failed iOS
development build and does not prove PostHog server receipt.

The release publication guard suite, including the corrected development
project-selection regression, passes. Those checks verify behavior, not
delivery from the requested physical development build.

### Earlier re-registration check

After the variables were registered again, all five required names were present
in the project-scoped `development` environment. Four sanitized components
match the intended development configuration:

- Supabase host: `qirxmktyicqwwfpowzjo.supabase.co`
- API host: `friction-1.replit.app`
- PostHog host: `us.i.posthog.com`
- PostHog token fingerprint: `32d2d8eaae570a8c`

The Supabase anon-key fingerprint does not match:

| Source | Supabase anon-key fingerprint | Full configuration fingerprint |
| --- | --- | --- |
| Intended local release configuration | `029d2dfdd64cd799` | `0889979680bbac77` |
| EAS `friction-dev` development environment | `6f64e3cfb0382044` | `0e4c6e6a6eb774f0` |

A publish was not started while this mismatched configuration was present. The
`EXPO_PUBLIC_SUPABASE_ANON_KEY` value in the `friction-dev` development
environment was later corrected, as recorded in the latest recheck above.

## Required next verification

1. Make the bundle-validation success hook aware that a development client has
   no embedded native JavaScript bundle, while retaining strict checks for
   profiles that do embed one.
2. Re-run `bash scripts/validate-eas-cloud-env.sh development`. It must still
   report track `development` and configuration fingerprint
   `0889979680bbac77`.
3. Run the existing `Publish iOS(dev)` workflow. Record the replacement build
   ID, platform, build number, and completion time. The hooks must pass and
   TestFlight submission must complete.
4. Install that exact replacement build on a physical device, connect it to the development
   Metro server, and filter device logs for `[PostHog diagnostic]`. Confirm
   `initialized`, then trigger the app's delivery probe and confirm
   `delivery_probe_flushed`.
5. In the PostHog project identified by token fingerprint
   `32d2d8eaae570a8c`, filter Live Events for `$friction_delivery_probe`. Match
   `release_track=development` and
   `configuration_fingerprint=0889979680bbac77`. Record only the platform and
   receipt time.

An explicit flush means the SDK accepted the local send attempt; only the
matching Live Events record proves server receipt.

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