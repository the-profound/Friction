---
name: Cross-component live pager sync (Reanimated shared values as controlled props)
description: How to extend an adjacent-slot pager's live drag-follow across a component boundary (e.g. parent page pager <-> child overlay card) for all four transition directions
---

# Passing Reanimated shared values down as "controlled" props

When a child component (e.g. a card/overlay with its own internal gesture) needs
to participate in the *same* live 1:1 drag-follow pager as its parent, don't give
it an internal shared value that starts its own entrance animation on mount.
Instead, lift the value to the parent and pass it down as a prop typed
`SharedValue<number>`. The child's `useAnimatedStyle` just reads it; the parent
(or the child's own gesture, or both, depending on direction) writes to it. This
lets one absolute-position value be driven by two different gesture recognizers
on two different transitions (e.g. forward-drag-in from parent, backward-drag-out
from child) without fighting over ownership or needing a handoff/sync effect.

**Why:** an early design considered mounting the child at a fixed `screenWidth`
offset and animating it in with its own `useEffect(() => withTiming(...), [])`
mount animation. That can't live-track a drag that's still in progress on the
*parent's* gesture recognizer (the child mounts mid-gesture, after the drag
already started) — the child's separate shared value has no way to know the
live finger position at mount time. A controlled prop sidesteps this: the parent
just seeds the shared value's initial `.value` synchronously before mounting the
child, then keeps writing to it every `onUpdate` frame.

**How to apply:** for a 4-direction pager relationship between screens A-B-C
(e.g. lastPage <-> card <-> completionScreen), each of the 4 transitions is
"owned" by whichever gesture recognizer is live during that specific drag — the
owning side writes to the shared value every frame; the non-owning side (already
mounted or about to mount) just reads it via `useAnimatedStyle`. Use one ref-based
guard per shared value (e.g. `xMountedRef`) to fire "mount now" exactly once per
gesture, and reset it in every terminating path: commit, below-threshold cancel,
AND `onFinalize`/external-cancel (easy to forget the last one — it left the
overlay stuck visible with a broken snap-back in an earlier draft).

**Gating existing "blocked while overlay visible" guards:** if the parent's main
gesture handler already has `if (overlayVisibleRef.current) return` in
onBegin/onUpdate/onEnd to stop the normal pager once a child overlay is shown, a
gesture that both starts blocked-off state AND continues past it (mounts the
overlay mid-drag then needs its own onEnd to fire) needs that guard updated in
**all** of onBegin/onUpdate/onEnd/onFinalize consistently — missing even one
(e.g. onEnd only) silently drops the release handler and the drag never resolves.

**"Mount guard" refs (fire onBegin-side-effect once per gesture) MUST be reset
on the commit/success path too, not just cancel.** A ref like `xMountedRef` /
`xBeginFiredRef` that gates a one-time "mount the next screen" side effect
inside `onUpdate` is easy to reset in every *cancel* branch (snap-back, onEnd
below-threshold, onFinalize) and forget to reset it once the gesture actually
*commits* successfully. Symptom: the feature works exactly once, then every
subsequent attempt silently no-ops (the `if (!xMountedRef.current)` check
skips the setup and the drag falls through to whatever the old/fallback branch
was) — reads to the user as "it worked once then went back to the old
behavior." Audit every ref like this: it needs a reset in ALL FOUR paths
(commit-finished callback, onEnd-cancel, onFinalize-cancel, AND the
timing-driven non-gesture/button equivalent of the same transition).

**A card's decorative "resting" layers (outside the live-drag transform) must
also carry the live-drag transform if the whole card is meant to move as one
unit.** QuestionCardCurl draws a "stack of pages" depth illusion behind its
main note (two extra Views, offset copies, different tint) as siblings inside
the same root wrapper. The wrapper's own transform (`entranceX`) only updates
on commit/cancel (mount/dismiss settle), while the live per-finger drag
(`cardTX`/`cardTY`) was applied ONLY to the main note View via a separate
animated style. Result: dragging the card visibly slid just the top note away
while the two stack-decoration layers stayed frozen mid-air (looked like a
random stray colored panel hovering in place) until the commit's entranceX
animation finally moved everything at once. Fix: give every sibling layer
that's supposed to be part of "the card" its own animated style reading the
same live drag shared value(s) — don't assume one transform on a wrapper
covers children that have their own translateX/Y baked into their own style.

**When two adjacent pager slots temporarily swap roles for a live-drag reveal,
you must swap them BACK once the drag settles, or the next forward drag looks
broken/frozen.** B (question card → last page) exposes the ALREADY-MOUNTED
"prev" slot live during the drag (its content matches the page currentPage
will become after decrement), while the "current" slot sits untouched,
parked off-screen from the prior A commit. `read.tsx`'s slot-reset
useLayoutEffect is deliberately suppressed for this transition (so it
doesn't cut off the live withTiming), but nothing then re-syncs the two
shared values once the withTiming's `finished` callback fires — so "prev"
is left sitting at the fully-revealed position (translateX 0) forever, on
top of (z-order-wise) the "current" slot which is still parked off-screen.
Since "prev" renders above "current", it silently occludes it: the next
forward (A) drag's live movement (which drives "current") is invisible,
hidden behind the frozen, fully-opaque "prev" layer, making the second A
transition look completely different (page appears frozen/static) from the
first. Fix: in the settle animation's completion callback, explicitly snap
current→0 (exposed) and prev→parked simultaneously (same frame, on the UI
thread) to hand the "visible" role back to "current" cleanly — no flicker
since both are showing identical content at that instant. General lesson:
any live-drag technique that temporarily borrows a neighboring slot/shared
value must restore both values to their normal at-rest state on commit
completion, not just the value it explicitly drove during the drag.

**A pager slot's React `key` (and any content derived the same way) must stay
pinned to its pre-commit value for as long as the slot is still visibly
mid-animation, even after the state driving it has already changed.** In B
(card → last page), `onDismissOverlay` decrements `currentPage` at the START
of the commit, but the "prev" slot's SETTLE ANIMATION (position) keeps
running for another ~360ms after that. The slot's content/key were derived
reactively as `currentPage - 1` on every render — so the instant
`currentPage` changed, "prev" recomputed to a DIFFERENT page (one further
back) while still visibly sliding into place mid-drag-settle, and — because
its key changed — React unmounted/remounted it, producing an overlap/flash
between the previous (correct, mid-flight) content and the newly-mounted
one. Fix: capture the pre-decrement index into a ref right before the state
change, use `ref.current ?? computedIndex` for both content and `key` while
the ref is set, and only clear the ref once the settle animation's
`onComplete` fires (by which point the slot is parked off-screen again and
free to reflect the new state). General lesson: whenever a value driving a
*live/settling* animation is computed from state that changes at the START
of that same commit, don't let the render pick up the new state value until
the animation is done — pin it in a ref for the animation's lifetime,
including anything (like a `key`) that would force a remount.

**A "virtual" pager index (one past the last real page, used to represent an
overlay/card state) must not make the underlying real-page slot go fully
`null`/unmounted if that same slot's WebView will need to be revealed again
soon.** During the card-overlay dwell (A committed, B not yet started),
`currentPage` is set to the virtual `totalPages` index, and `currentNode`
was computed as `makeNode(currentPage)` — which explicitly returns `null`
for that virtual index — unmounting the "current" slot's WebView entirely
(harmless since it's parked off-screen). But when B commits and
`currentPage` decrements back to a real index, "current" has to freshly
mount a brand-new WebView instance, racing the ~360ms settle animation to
finish loading before it's revealed — a real (if fresh-mount was slow) or
occasional blank-flash bug. Fix: clamp the index used for "current" content
+ key to the last real page whenever `currentPage` is the virtual index
(`currentPage >= totalPages ? totalPages - 1 : currentPage`), so the same
WebView instance stays continuously mounted (invisible, parked) all the way
from A's commit through the whole card dwell and into B's settle — by the
time it's revealed it's already had the ENTIRE dwell time to load, not just
360ms. Same family of bug as the "prev" slot key-pinning fix: anything
computed from a piece of state that changes at commit boundaries, if it
gates a slot's mount/unmount, should be checked for whether it needlessly
tears down a WebView that will need to reappear again shortly after.

**onEnd must reuse onUpdate's axis/branch decision, not re-derive it.** If
`onUpdate` classifies a drag as horizontal-vs-vertical (or forward-vs-backward)
via `Math.abs(dy) > Math.abs(dx)` computed fresh every call, and `onEnd`
independently recomputes the same comparison from the final cumulative
translation, the two can disagree when the release point's dx/dy ratio drifts
from what dominated mid-drag (natural for a diagonal-ish real swipe). Result:
onUpdate spent the whole gesture live-driving branch A, but onEnd resolves
branch B — dropping the live drag with no commit/cancel, or worse, firing an
unrelated legacy gesture handler (e.g. an old vertical-swipe feature) that
happens to share the same Gesture.Pan(). Fix: lock the axis into a ref once
per gesture (reset in onBegin, set on the first onUpdate call where either
axis clearly exceeds a small deadzone) and have onEnd read that locked ref
instead of recomputing.

**A shared value driven by only ONE of two opposite-direction transitions
looks like "B is floating in front of A" instead of a side-by-side swap.**
Card→completion (C) drove BOTH the card's own live drag position (`cardTX`)
and the completion screen's entrance position (`completeEntranceX`) in
lockstep every frame, so the card visibly slid out left while the completion
screen slid in from the right in the same motion. The reverse transition
(completion→card, D) was implemented as a separate gesture living entirely
inside the completion screen component, and only touched
`completeEntranceX` — it had no reference to `cardTX` at all (it was a
*local* shared value owned by the card's own component). Since the card's
commit-finished callback also reset `cardTX` back to 0 (its at-rest/visible
value) once C finished, the card sat fully in place, merely hidden behind
the completion screen's opaque overlay — so D's drag revealed an
already-present card instead of one sliding in from off-screen, reading as
"the completion screen is in front of the card" rather than a natural
adjacent swipe. Fix: lift the shared value that only one side previously
owned into the common parent, pass it into BOTH components as a prop, and
derive it algebraically from the other side's already-correct live value
(here `cardTX = completeEntranceX - screenWidth`, mirroring the forward
transition's `completeEntranceX = screenWidth + dx` where `dx` was that same
`cardTX`). Critically, also stop resetting the lifted value to its "at rest"
number when the transition that hides it commits — leave it parked at the
off-screen position instead, so the *next* transition (in either direction)
has an accurate starting point to reveal from. General lesson: for any pair
of opposite-direction transitions between two screens, audit whether EACH
direction's gesture writes to ALL the shared values the OTHER direction
depends on for a synced reveal — a value "owned" by only the forward
transition will silently go stale/wrong the moment the reverse transition
needs to read or drive it too.

**Lifting a shared value from "local to a component" to "owned by the
parent, persists across mount/unmount" removes its free implicit reset —
you must add an explicit one at every fresh-mount site.** Before lifting
`cardTX` out of QuestionCardCurl, every fresh mount of that component
naturally got `cardTX = 0` for free (a new component instance means a new
`useSharedValue(0)`). After lifting it into read.tsx so D could drive it
too, the SAME shared value now survives across QuestionCardCurl
unmount/remount cycles — so any code path that unmounts the card while
`cardTX` is parked at a non-zero offset (e.g. a button-driven "닫기/다시
읽기" exit taken right after a C-commit, which skips the drag gesture's
own cleanup entirely) leaves that stale offset sitting there for the
*next* fresh A-entrance mount to inherit, silently compounding with the
entrance animation's own transform on a sibling/wrapper node. Fix: at
every site that begins a fresh mount of the component that reads the
lifted value (both the drag-driven and the button/timing-driven A-entrance
start), explicitly reset the lifted value to its zero/rest state, don't
rely on unmount-time cleanup alone (too many non-gesture exit paths to
audit exhaustively). General lesson: whenever a shared value moves from
component-local to parent-owned/persistent, audit ALL of that value's
consumers' (re-)mount sites for an explicit reset — the free "new
component instance = fresh value" reset you had before is gone.

**A pager slot keyed purely by page index will collide when a "virtual"
index makes two different-role slots resolve to the same real page.**
`currentPageIdx`/`prevPageIdx` were each clamped/derived to point at the
same last-real-page index while `currentPage` held the virtual
"card-is-floating" index (`totalPages`) and no B-drag was pinning a
different prev index yet — both the "current" and "prev" sibling elements
ended up with the identical `page-${n}` key, producing a React
"Encountered two children with the same key" warning (silent in
production, but signals the two slots' identities are ambiguous to
React's reconciler even though they're visually distinguishable by
z-order/transform). Fix: suffix each slot's key with its constant role
(`-next`/`-current`/`-prev`) so identically-indexed slots stay distinct
without disturbing the existing "same key = don't remount" identity
semantics for a given slot as its own index changes over time. General
lesson: whenever multiple sibling slots in a multi-slot pager can
legitimately point at the same underlying index (virtual/dwell states,
pinned-during-settle states), key by `(role, index)` not index alone.

**(Supersedes the "prev slot reveal" description above) B is now a true PUSH
driven through the CURRENT slot, and the dwell parks current off-screen.**
The old B implementation drove `dismissPrevSlotSV` — but during the card
dwell the prev slot render is SKIPPED (currentPageIdx === prevPageIdx key
collision), so that drive was a no-op and B only "worked" because the slot
-reset useLayoutEffect had incorrectly snapped the current slot (last page)
back to translateX 0 behind the card — visible as "a letter page stuck
behind the card stack" once the card shrank below full-screen. Current
architecture: (1) the slot-reset effect parks `currentSlotSV` at
-(W+PARK_EXTRA) whenever `currentPage >= totalPages` (card dwell); (2) B's
drag drives `currentSlotSV = min(0, dx - W)` glued 1:1 to `cardTX` with
`flatTransitionSV = 1` (the initial jump from -(W+PARK_EXTRA) to ≈ -W is
invisible — both off-screen); (3) B-commit sets the card's animatingRef
BEFORE `onDismissOverlay` — without it, a new gesture starting mid-settle
fires onDismissOverlay/prevPage() twice and jumps back two pages; (4) the
card's own gesture ignores input while `entranceX.value > 0.5` (A entrance
still animating) so it can't fight the entrance timing on the same values.
