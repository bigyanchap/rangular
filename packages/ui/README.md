# @rangular/ui

Rangular Material for generated apps.

- `src/tokens.ts`, pure TypeScript design tokens (spacing, radius, type
  scale, light/dark colour roles). Part of the repo build and unit tests.
- `src/icons.ts`, the curated icon set as SVG path data, the size scale
  and the default size. Part of the repo build and unit tests.
- `src/datetime.ts`, the date-time picker's value model: ISO parsing
  and composition, leap correct month lengths, wheel specifications
  for the date, time and datetime modes, and display formatting.
  Part of the repo build and unit tests.
- `src/primitives.tsx`, React Native primitives (`RgScreen`, `RgAppbar`,
  `RgCard`, `RgButton`, `RgText`, `RgList`, `RgRow`, `RgFab`, `RgSwitch`,
  `RgCheckbox`, `RgSwitcher`, `RgOption`, `RgRadioGroup`, `RgRadio`,
  `RgIcon`, `RgInput`, `RgOutlet`, `RgSheet`, `RgDialog`, `RgActions`,
  `RgSnackbar`, `RgDateTimePicker`). This is **shipped source**: it is
  bundled into generated apps and is intentionally excluded from this
  repo's `tsc` build, because react-native types are not a dependency
  of this repository.
