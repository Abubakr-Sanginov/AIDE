---
name: react-frontend
description: Correct, accessible React + TypeScript UI code - components, state, effects, forms, loading/error states, keyboard and screen-reader support, responsive layout. Use when building or fixing frontend components, pages, forms or styling (React, Next.js, Vite, Tailwind).
---

# React frontend quality

## Components and state
- Function components with typed props (`interface Props`). No `any`.
- Keep state minimal; derive values instead of syncing copies with `useEffect`.
- Lists need stable `key`s from data ids, never the array index for lists that can reorder.
- `useEffect` only for syncing with something outside React (subscriptions, timers, DOM, network). Return a cleanup, list every dependency, ignore stale responses (AbortController or an `ignore` flag).
- Never mutate state; create new arrays and objects.
- Lift state only as far as needed; use the project's store (Zustand, Redux, Context) the way existing code does.

## Data and async
- Every async view has three states: loading, error (with retry or a clear message) and empty. Design all three.
- Disable submit buttons while a request is in flight; prevent double submit.
- Validate forms on the client for UX, but assume the server validates too.
- Render user content as text (JSX escapes it). Never `dangerouslySetInnerHTML` with user or model data.

## Accessibility
- Use real elements: `<button>` for actions, `<a href>` for navigation, `<label>` bound to inputs.
- Every icon-only button has an `aria-label`. Images have `alt`.
- Everything works with the keyboard: Tab order, Enter and Space, Escape closes dialogs, visible focus ring.
- Sufficient contrast; do not convey meaning with color alone.

## Layout and styling
- Use the project's design tokens or Tailwind theme instead of hard-coded colors and sizes.
- Check narrow widths for overflow, long words and long translations (`min-w-0`, `truncate`, `break-words`).
- Respect `prefers-reduced-motion` for large animations.

## Before finishing
- Type-check and build. Open the page and click through the changed flow, including error and empty states. Check the console for warnings (missing keys, failed requests).
