---
name: RN Web Text with null sibling
description: Why a nested <Text> block can render fully blank on Expo/RN Web, and the fix pattern.
---

# React Native Web: `<Text>` with a `null` sibling can render entirely blank

**Symptom:** A `<Text>` wrapping several children — some of them
`{condition ? <Text>...</Text> : null}` or bare string literals mixed with
`<Text>` siblings — renders as completely empty on Expo/RN **Web** (native
iOS/Android is usually fine), even though every branch looks syntactically
correct.

**Why:** RN Web does not reliably handle mixed child node types (a literal
`null`, or a raw string, sitting next to `<Text>` element children) inside one
parent `<Text>`. This has recurred more than once in
`artifacts/friction/app/space-create.tsx`'s `ConfirmStep` — first fixed, then
reintroduced when the component was rewritten during an unrelated feature
change, because the fix isn't visible from reading the JSX alone (it "looks
right").

**How to apply:** whenever a `<Text>` has multiple children, make every direct
child a `<Text>` element — never `null`, never a bare string/expression next to
`<Text>` siblings:
- `{cond ? <Text>...</Text> : null}` → `{cond ? <Text>...</Text> : <Text>{""}</Text>}`
- `{"literal "}<Text>...</Text>` → `<Text>{"literal "}</Text><Text>...</Text>`

Check this pattern first if a summary/confirmation screen's text silently
fails to render on web while the same code paths work natively.
