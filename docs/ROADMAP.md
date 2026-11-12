# Rangular roadmap

This roadmap records the plan approved by Bigyan on 12 November 2026. It covers Stage 6 through Stage 12. Each stage is built in order, and each stage lands as one complete change with compiler support, tests, a tiny example, a recipe card and a regenerated catalog.

## Standing rules

1. Source code never deviates from Angular style. Angular syntax and Angular semantics stay faithful. Only the rendering target changes.
2. Every feature is grounded in the official Angular documentation or in the Angular Material component that Angular applications already know.
3. Where Angular Material or a component library of the same class has a loved component for a job, Rangular builds the best version of that component rather than a rough equivalent.
4. The date and time picker in Stage 10 must look like the iOS wheel picker. It must not look like the Android picker.
5. The preview is a promise. A screen that works in the preview must work as a React Native app from the same generated code.
6. No stage is done on compiler support alone. The example, the recipe card, the catalog and the tests ship in the same change.

## Stage 6: Controls

Status: built in this change.

Angular ground: Angular Material form controls and selection controls, mainly `mat-slide-toggle`, `mat-checkbox`, `mat-button-toggle-group` and `mat-radio-group`.

The stage adds `switch`, `checkbox`, `switcher` with `option`, and `radio-group` with `radio`. Each control follows the Material pattern: a bound value goes in, a `(change)` event carries the next value out as `$event`, and a method in the component class writes the value to state. The switcher changes view state inside one screen. It is not routing. The settings example proves all four controls in the compiler output and in the interactive preview.

## Stage 7: Icons

Angular ground: Angular Material `mat-icon` and the Material icon set that Angular applications use through the icon component.

The stage adds an Angular style icon block with a curated set of everyday Material style icons. One icon set serves the generated app and the preview, so the two cannot drift apart. An unknown icon name becomes a diagnostic whose fix lists the valid names, and the catalog lists every available icon.

## Stage 8: Forms

Angular ground: the Angular forms guide, covering template driven forms and reactive forms.

The stage adds `[(ngModel)]` two way binding, template driven forms, reactive forms built from form controls and form groups, and the standard validators. Form state, validity and error display follow Angular semantics. The generated React Native code stays an implementation detail under the Angular source.

## Stage 9: Routing

Angular ground: the Angular Router guide, covering route configuration, `RouterOutlet`, `RouterLink` and route parameters through `ActivatedRoute`.

The stage adds a `Routes` configuration, a `router-outlet` block, `routerLink` navigation and route parameters. The Angular source keeps the router model. The generated app maps that model to native navigation.

## Stage 10: Pickers and overlays

Angular ground: Angular Material datepicker, dialog, bottom sheet and snack bar components.

The stage adds a date and time picker with date mode, time mode and combined mode, plus a bottom sheet, a dialog and a snackbar. The picker uses the iOS wheel look in every mode. Overlay behaviour follows the Material patterns Angular developers already know, rendered for a phone screen.

## Stage 11: Data display

Angular ground: Angular Material tabs, expansion panels, table, autocomplete, slider, progress indicators, chips and badge.

The stage adds tabs, an accordion, a table, autocomplete, a slider, progress display, chips and a badge. Each item follows the most loved version of its component class and stays in Angular style at the source level.

## Stage 12: Language completeness and app readiness

Angular ground: the Angular guides for pipes, attribute directives and content projection with `ng-content`.

The stage adds custom pipe classes, attribute directives, the full set of built in pipes and content projection. It also makes app building real: `rangular init` produces a runnable Expo app scaffold, the closing security re-audit runs over the whole system, and a fresh AI proof test builds an app from the docs alone. When this stage lands, a user can make an app using Rangular, and that is the point where Bigyan is notified.
