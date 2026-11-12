# @rangular/ui

Rangular Material for generated apps.

- `src/tokens.ts` — pure TypeScript design tokens (spacing, radius, type
  scale, light/dark colour roles). Part of the repo build and unit tests.
- `src/primitives.tsx` — React Native primitives (`RgScreen`, `RgAppbar`,
  `RgCard`, `RgButton`, `RgText`, `RgList`, `RgRow`, `RgFab`). This is
  **shipped source**: it is bundled into generated apps and is intentionally
  excluded from this repo's `tsc` build, because react-native types are not a
  dependency of this repository.
