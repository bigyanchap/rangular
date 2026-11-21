# Using third-party libraries

Rangular ships the everyday blocks: layout, controls, forms, tables,
navigation, pickers, charts and the rest of the catalog. Heavy native
widgets are not built in: maps, video players, WebViews, live cameras
and rich text editors need native setup, per-app choices and, for
maps, your own API keys. React Native, Flutter and Capacitor all ship
these as separate packages too, and so does Rangular.

You are not blocked. There are three paths, and this page states each
one with its limits, plainly.

## The borderline

The framework provides the Angular-shaped surface itself: the
compiler and its subset, the catalog of built-in blocks, routing,
forms, services and dependency injection, HTTP, theming and the
preview. That is the whole built-in side, and it is deliberately
the everyday side.

Everything heavy or platform-specific is yours to install as a
React Native or Expo package and integrate through one of the
three paths below: maps, video, camera, WebView, rich text
editors, databases, and anything that needs native setup,
permissions, API keys or per-app choices. Two installs are
required for any app that uses `@rangular-framework/ui`, expo-image-picker
and expo-document-picker, because Metro resolves them at bundle
time. Blessed patterns name their own installs on top, expo-sqlite
for database work being the standing example.

The rule of thumb: if it renders everyday interface from data,
look in the catalog first. If it needs the platform, it is a
package you install.

## Path 1: a third-party component in a template

Import the component in your component file, the way you import
anything. Imports are carried into the generated code. Then use it
as a tag:

```ts
import MapView, { Marker } from 'react-native-maps';
```

```html
<MapView [initialRegion]="region" (regionChange)="regionChanged">
  <Marker [coordinate]="pin" title="Home"></Marker>
</MapView>
```

The rules:

- A tag that starts with a capital letter, or contains a hyphen, is
  kept as that component. Static attributes become string props,
  `[prop]` bindings become props, and child tags nest normally.
- A lowercase tag the catalog does not know is not kept. It warns
  `GEN_UNKNOWN_TAG` and degrades to a plain view.
- Handlers receive `$event` here as everywhere else: a handler
  written as `(regionChange)="onRegion($event)"` gets the value the
  third-party component passes, and a bare method reference, as in
  the example above, `(regionChange)="regionChanged"`, receives it
  as its argument directly.

## Path 2: wrap it in a child component (recommended)

Write a small child component whose template holds the third-party
tag, and whose inputs and outputs are ordinary Angular-style
bindings. The rest of your app then never sees the library's own
API.

```ts
import { Component, EventEmitter, Input, Output } from '@angular/core';
import MapView, { Marker } from 'react-native-maps';

@Component({
  selector: 'app-mapwrap',
  templateUrl: './mapwrap.component.html',
})
export class MapwrapComponent {
  @Input() region: any;
  @Output() moved = new EventEmitter<any>();

  regionChanged(r: any) {
    this.moved.emit(r);
  }
}
```

Its template holds the map:

```html
<MapView [initialRegion]="region" (regionChange)="regionChanged">
  <Marker [coordinate]="pin" title="Home"></Marker>
</MapView>
```

And the host uses clean bindings, where `$event` works as usual:

```html
<app-mapwrap [region]="region" (moved)="onMoved($event)"></app-mapwrap>
```

One trap: write handlers as plain methods, as above. An
arrow-function field (`regionChanged = (r) => { ... }`) is dropped
with a `GEN_FIELD` warning and the handler never runs.

## Path 3: a service for a non-visual library

A service can import a third-party module and drive it, when the
library shows nothing itself: location, storage, analytics, a
network SDK.

```ts
import { Injectable } from '@angular/core';
import * as Location from 'expo-location';

@Injectable({ providedIn: 'root' })
export class PlaceService {
  label = 'Not read yet';

  read() {
    Location.getCurrentPositionAsync({}).then((pos) => {
      this.label = 'Read';
    });
  }
}
```

The limits: `await` inside a method is outside the subset and warns
`METHOD_UNSUPPORTED`, so use the `.then` form. Service state
propagates when you assign a field, not when you mutate one. A
service cannot render anything; visual results come back through a
component, by Path 1 or Path 2.

A database is this path, and it has a blessed shape. For SQLite,
install `expo-sqlite` in your app and let one root service own it:
the service opens the database file in its constructor, creates
the tables with `execAsync`, and answers queries with `runAsync`
and `getAllAsync`, assigning every result to a field. Screens
inject the service and bind to its fields; SQL lives in exactly
one place, and no component touches the database. The worked
example is `examples/sqlite-notes`, with the full recipe card.
There is no built-in database and no ORM: React Native ships
none either, and the engine itself is the phone's own SQLite,
present on every device.

## Setup belongs to your app

- Install the package in your app, and add its Expo config plugin
  entries to your `app.json`. After scaffolding, `app.json` and
  `package.json` are yours; the framework does not write them again.
- Expo Go carries a fixed set of native libraries. Maps, video,
  camera and WebView are in that set, so you can try them in Expo
  Go. A library outside the set needs a development build.
- Maps: `react-native-maps` on Android is Google Maps. A store
  build needs your own Google Cloud project, the Maps SDK enabled,
  and an API key per platform, given through the library's config
  plugin. The key is yours, billed to your account, and is needed
  at build time.
- Camera: the permission messages come from the library's config
  plugin and are baked into a real build. In Expo Go you see Expo
  Go's own permission text instead.

## What the preview shows

The browser preview cannot render a third-party native widget. It
shows the widget's children in a plain stack, as a stand-in. The
real widget renders in the app. Do not read the preview stack as
the app's layout for that part of the screen.

## The flagship cases

| Case | Library | Notes |
| --- | --- | --- |
| Maps | `react-native-maps` | Your Google keys for store builds. No web version exists: the import alone breaks a web bundle, so a wrapper that also targets web needs a web fallback of your own, or the app gives up its web export |
| Video | `expo-video` | First-party Expo module, works in Expo Go, supports web, no key. The lightest heavy case |
| WebView | `react-native-webview` | Works in Expo Go. On web it renders an unsupported-platform message while the export still succeeds, so a green web export does not prove the page works |
| Camera | `expo-camera` | First-party Expo module, works in Expo Go, includes barcode scanning. Permission wording applies in a real build |
| Rich text editor | `@10play/tentap-editor`, `react-native-pell-rich-editor` | Both are editors inside a WebView, with the weight that carries. Wrap one by Path 2 if your app needs it. The built-in `<editor>` covers block notes with light marks and stays the default answer |

## What is not supported

- Hand-written React components (`.tsx` files) imported into
  Rangular source. The compiler resolves classes, not TSX files,
  and reports `CMP_IMPORT_UNRESOLVED`. Hand-written screens can
  sit beside the generated root in your app's own entry file, but
  they live outside Rangular routing and outside the framework.
- Heavy widgets as built-in blocks. That is a decision, not an
  oversight: a built-in would force the library, its config plugin
  and its keys onto every generated app, including the apps that
  never use it.
