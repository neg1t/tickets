---
name: frontend-conventions
description: Use when creating or changing frontend code in this repository, including React pages, Effector models, Ant Design UI, API wiring, forms, and responsive layouts
---

# Frontend Conventions

Use this skill for frontend work in the repository. Follow its existing FSD structure and UI patterns. Keep React components focused on rendering and put page workflows in Effector models.

## Structure and naming

- Follow FSD public APIs and layer boundaries. Put role-specific pages below `pages/<role>/`, for example `pages/admin/` and `pages/admin-dup/`.
- Folders use lowercase `kebab-case`. Component and container files use `PascalCase.tsx`; helpers, types, models, and other non-component files use `camelCase`. Keep `index.ts` / `index.tsx` for public API barrels.
- Page models use `*.model.ts`; admin dictionary models may use `<resource>Model.ts` to match nearby dictionary slices. Keep Effector gates, events, effects, stores, and samples in `model/`.
- Slice-local types, selectors, formatters, and helper builders belong in `lib/`. Put temporary backend-less shared data in `shared/mocks`.
- Before choosing a structure, inspect a nearby implementation of the same kind of slice. For list/detail/overlay pages, use the block-oriented structure in `src/widgets/divisions/model/divisions.model.ts` and its related UI components as a reference.
- Preserve nearby naming, block order, and public model shape unless the request asks for a behavior change. Keep structural cleanup separate from unrelated API, validation, payload, or UI changes.

## API and forms

- Use generated Kubb services, DTOs, and enums from `shared/api/gen`. Do not create HTTP clients, endpoint adapters, or duplicate API contracts in `shared/api`, pages, entities, or `lib`; fix or regenerate Kubb instead. A page-local `lib/fetch.ts` may expose verb-named generated methods for `Parameters` / `ReturnType` inference only.
- For admin flows, replace page mocks with generated contracts when an endpoint exists. Keep dictionary CRUD, filters, pagination, and overlays in the owning admin page slice. Reserve `entities/dictionaries` for genuinely shared, read-only lookup state.
- When replacing mocks with an API, compare each table column, mobile card, and detail field with the generated response. Read nested values explicitly, such as `branch_type.name`.
- Keep API filter, sorting, and pagination together in the page's filter store. Create or update filters through the page model, and reset the current page when a search or non-pagination filter changes. Exclude pagination fields from export requests when the endpoint does not accept them.
- Set the initial list `page_size` from `PAGINATION_DEFAULT_LIMIT` in `shared/lib/filter`; do not hardcode the default pagination limit in `INITIAL_FILTER`.
- For a filterable list, keep the complete API query filter in one Effector store and expose one `updateFilter` event to change it. Search, selects, date filters, tabs, and pagination all update that store through `updateFilter`; keep `resetFilter` as a separate event when useful. Avoid separate `$search` stores and `searchChanged` / `updatePagination` events. Filter changes reset `page` to `1`; pagination payloads passed to `updateFilter` preserve the requested page and page size.
- Debounce list-search requests with `debounce` from `patronum` so typing does not issue a request per keystroke. Use the shared `SEARCH_DEBOUNCE_DELAY_MS` constant (currently `300`) and the reusable `createDebouncedEvent` helper from `shared/lib/effector-factories`. Keep the input value in the filter store so it updates immediately; debounce the request-producing filter update stream, then sample the latest complete filter for the API call. Do not keep a second debounced-query store.
- Put reusable API filter and response aliases in the slice's `lib/types.ts`. Derive filter types from the page-local fetch method, for example `NonNullable<Parameters<typeof jobsApi.listJobs>[0]>`, and derive response types from its return value, for example `Awaited<ReturnType<typeof jobsApi.listJobs>>['data']`. Avoid importing generated `*Response` types directly: the fetch method is the single point to change when backend contracts are renamed. Derive item types from response collections with `Response['items'][number]`.
- Update list result and error stores directly from `fetchFx.doneData` and `fetchFx.failData` (or `done` / `fail` samples directly into the store when a condition is required). Do not add intermediary `*Received` or `*Failed` events that only forward effect results.
- When a page gate already exposes whether a page is active, use `PageGate.status` in `sample` instead of mirroring it into a separate `$pageIsOpen` store.
- Keep create flows separate from detail/edit flows so creation does not issue a detail request with an empty ID. For dependent endpoints, pass the entity ID required by the path contract.
- A form may use UI-oriented values, but validate those values and map them explicitly to the generated request. For PATCH, pass path identifiers separately and preserve concurrency fields such as `version` in the body.
- API-backed Formik forms use the established Formik + Zod adapter with `enableReinitialize` for edit data. Keep optionality consistent across UI types, initial values, and schemas. A non-required field that may be `undefined` or `null` must use `.optional()` or `.nullable()`.
- Read [formik-patterns](../formik-patterns/SKILL.md) when a task adds or refactors a form. Use Formik for every form's values, validation, and submission. Ant Design `Form` is only for layout, labels, and validation feedback; do not use its store or validation APIs (`Form.useForm`, `Form.useWatch`, named `Form.Item` fields, `rules`, or `initialValues`). Bind controls to Formik values and handlers, validate with the project's Zod adapter, and show Formik errors through `Form.Item`'s `help` and `validateStatus`. An Ant Design `Form` may forward its submit event to `formik.handleSubmit`, but must not own field state or validation.
- When using Zod with Formik, pass `toFormikValidate(schema)` through Formik's `validate` prop. Formik's `validationSchema` path normalizes empty strings to `undefined` before validation, which makes required `z.string()` fields fail with `Invalid input: expected string, received undefined` instead of reporting the intended empty-field validation message. Keep empty UI values as strings when the field is required; use `.optional()` / `.nullable()` only when the domain value is actually optional / nullable.
- Ant Design `Select` clearing may emit `undefined`. Normalize it before calling `setFieldValue`: use `value ?? ''` for required strings or `null` for nullable API fields.
- Reuse shared validation and normalization helpers for domain formats such as Russian phone numbers. Submit optional empty values in the API's nullable form rather than as partial masks.

## Effector models

- Prefer Effector for page workflows, route-driven state, selected data, overlays, and loading state. Keep only strictly ephemeral widget control state local, such as an AntD image preview's `open` and `current` values.
- Effector data stores must not use `undefined` as a state value or as the initial value. For absent data, use an explicit `null` state (for example, `createStore<Item | null>(null)`) or a discriminated union; normalize optional API and route values before storing them. Apply the same rule to gates that carry optional identifiers: use `createGate<string | null>({ defaultState: null })` and pass `value ?? null`. No-payload gates may keep their normal `void` props.
- Connect pages with `useGate(...)` and `useUnit(...)`. Group each `useUnit` call around one local workflow. Pair a store with the event that updates it in the same group; for example, read `$filter` together with `updateFilter`. Keep unrelated list data and loading state in their own group rather than adding everything to one catch-all call.

```tsx
const [filter, updateFilter] = useUnit([
	pageModel.stores.$filter,
	pageModel.events.updateFilter,
])

const [data, loading] = useUnit([
	pageModel.stores.$list,
	pageModel.loading.$listLoading,
])
```

- Keep each `useUnit` destructuring beside the workflow that consumes it. A page-slice component that owns an interaction reads only its relevant stores and events; do not pass page model units through intermediate slice components. Shared and visual-only components receive display props only.
- Keep presentational shared UI state-free. Prefer a content-level smart component over broad prop drilling when the state already belongs to the page workflow.
- Name every `*.pending` store with `Loading`, such as `$userLoading` or `$updateUserLoading`.
- Organize models as named workflow blocks separated by a blank line and the repository's separator comment. Keep each related effect, loading store, public event, store update, and `sample` wiring together.
- A typical model groups gate/list/detail fetches, mutations, downloads, overlays and cleanup, then public `stores`, `events`, `loading`, workflow groups, and the final model export. Declare groups before the export and attach them by reference. Avoid empty or unused stores and events.
- Attach a known reset trigger when declaring its store, for example `createStore<Item | null>(null).reset(PageGate.close)`. Keep multi-workflow cleanup samples beside the overlay and effect wiring.
- Use `createModal()` and `createDrawer()` from `shared/lib/effector-factories` for shared modal and drawer state. Store overlay payloads and active tabs/groups in Effector; open and close them through model events.

## React components

- Type every prop. Components with props receive a single `props` argument and destructure inside the function body.
- Name handlers `handle<Context>` and callback props `on<Context>`; give utility and API functions verb-led, specific names.
- Keep interactions in the page-slice component that owns them. A page-local interactive toolbar, registry, overlay, or card reads its own relevant model units; do not forward actions through multiple layers.
- Separate every JSX sibling tag at the same nesting level with a blank line. Apply the same separation to logical sections in TSX; Prettier does not add these blank lines automatically.

## Ant Design and design implementation

- Use Ant Design for controls already in the library: tables, pagination, inputs, selects, buttons, cards, drawers, menus, tags, typography, and icons. Do not hand-build these controls or add another UI/icon library for a design task.
- A data registry uses `Table`. Paginated AntD tables use `getApiPaginationObject(...)` in that table. Do not render standalone pagination except for a mobile card view without a table; bind it to the same API filter store.
- Use `TableColumnTitle` from `shared/ui` for repeated table headers and `MobileBottomAction` for fixed mobile actions. Compose an AntD `Button` inside `MobileBottomAction` and keep its event in the owning page slice.
- Put recurring AntD appearance in the root `ConfigProvider` using `theme.components`. Page-level component classes may adjust geometry unique to that page but should not repeat the shared component shell.
- Use semantic AntD CSS variables. Avoid hardcoded colors and inline styles. Tailwind is the default styling mechanism; add CSS/SCSS only when Tailwind cannot express the requirement.
- Tailwind arbitrary values with pixel units are forbidden, including `w-[208px]`, `rounded-[12px]`, and `text-[14px]`. Use the Tailwind scale, semantic tokens, or AntD tokens instead.
- Use `dayjs` for date handling; do not manually append timezone offsets.
- For dashboard layouts below `md` (768px), use the mobile topbar and drawer navigation, show integrations before KPIs, and use a full-width `Select` instead of a segmented period control. KPI labels and descriptions may wrap on mobile; truncate only from `md` upward and preserve full text with `title`.
- For Figma implementation, inspect the target slice and installed UI components first, use the provided design context and screenshot, adapt it to project conventions, and verify the requested screen without changing unrelated mismatches.

## Verification

- For behavior changes, run the relevant test first when tests are requested or required by the task. Before handoff, run applicable repository checks such as `ts:check`, `lint`, and `fsd:check` when available.
- Do not treat `tsc --noEmit` at a solution config with `files: []` and `references` as a TypeScript check: it can exit successfully without checking referenced projects. Use the repository's project-aware `yarn ts:check` and inspect its exit code and diagnostics.
- `lint-staged` runs `yarn ts:check:staged` for staged TypeScript files. Confirm its output includes the changed files and has no diagnostics for them; ESLint and a successful build do not replace TypeScript checking.
- Do not report a TypeScript check as passing unless the exact project-aware command completed with exit code 0. If the full-project check reports existing diagnostics outside the current change, report that separately and use the staged TypeScript check for the changed files.
- Inspect changed UI code for `\[[^\]]*px` and correct every match.
- Playwright may be used for temporary local visual and interaction checks. Do not add Playwright configuration, scripts, tests, screenshots, traces, videos, reports, or output directories to the repository unless explicitly requested.
