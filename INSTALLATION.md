# Installation and your first app

Rangular is installed and used the Angular way: install the CLI once,
create an app with one command, then serve it and watch it run. In
Angular the app runs in a browser; here it runs in Expo Go on your
phone, which plays the browser's role.

## The journey

### 0. Prerequisite

Node.js 20 or newer, which includes npm. Also install Expo Go on your
phone from its app store.

### 1. Install the CLI

```sh
npm install -g @rangular/cli
```

This puts one command on your machine, `rangular`, available in every
folder, the way `@angular/cli` provides `ng`.

### 2. Create the app

```sh
rangular new my-habit-app
```

One command creates the project folder, writes the app, and installs
its dependencies, the way `ng new` does. The starter app inside is a
working Hello World: `src/app.component.ts` with its template in
`src/app.component.html`, already compiled and ready to run.

### 3. Go into the app

```sh
cd my-habit-app
```

### 4. Serve it

```sh
rangular serve
```

This compiles your Angular source, starts Expo, and prints a QR code
in the terminal. Scan it with Expo Go and Hello World is on your
phone. Leave it running: serve watches your source, and every save
recompiles and refreshes the phone, the way `ng serve` refreshes the
browser tab.

### 5. Make the first edit

Open `src/app.component.html`, change the greeting, save. The phone
updates by itself. That is the whole loop: write Angular, run native.

## Naming a project

The name is the argument of the create command. There is no separate
naming step and no prompt.

1. Give a bare name, like `rangular new my-habit-app`, and the
   project is created in a folder of that name where you stand. Or
   give an explicit path, like `rangular new ../my-habit-app`, and
   the project is created exactly there; the last part of the path
   becomes the name.
2. A bare name may use letters, digits, dot, underscore and hyphen.
   No spaces, no slashes, and `.` or `..` are refused. Breaking the
   rule stops with an error (`CLI_INIT_UNSAFE`) that shows the fix.
3. The target folder must be new or empty. If it already has files,
   the command refuses (`CLI_INIT_NOT_EMPTY`) rather than overwriting
   anything.
4. From the one name, everything else is derived: the folder name as
   typed; the package name in `package.json`, a cleaned version of
   the folder name; and the app name, slug and URL scheme in
   `app.json`, all set to that cleaned name. The slug is the app's
   identity in Expo, and the scheme is how links open it, for example
   `my-habit-app://`.
5. The cleaning rule: lowercase the name, turn any run of characters
   outside letters, digits, dot, underscore and hyphen into a single
   hyphen, and strip leading dots and hyphens. A folder called
   `My_Habit App` becomes the package name `my-habit-app`. If
   cleaning leaves nothing, the fallback is `rangular-app`.
6. Because `app.json` carries the cleaned name, the name under the
   app icon on the phone is the cleaned form too. To change it, edit
   `name` in `app.json`.
7. Renaming later is manual and simple: rename the folder, then
   change `name` in `package.json` and `name`, `slug` and `scheme`
   in `app.json` to match. Nothing in the generated code carries the
   project name, so no recompile is needed for a rename.

## Status today

The steps above are the way Rangular is meant to be used, and they
are the spec the npm release is built to. The packages are not on npm
yet, so until the first publish, work from a clone of this repo; the
steps map one to one:

```sh
git clone https://github.com/bigyanchap/rangular.git
cd rangular
npm install
npm test
node dist/packages/cli/src/cli.js init my-habit-app --app
cd apps/my-habit-app
npm install
npx expo start
```

The clone form differs only in the command prefix: `init <name>
--app` is today's `new`, a bare name lands in the checkout's `apps/`
folder, and there is no single `serve` command yet, so Expo is
started directly and components are recompiled with the build
command spelled out in the created app's own README.
