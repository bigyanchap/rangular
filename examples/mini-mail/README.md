# Recipe: Mini Mail, routing with an outlet, links and route parameters

**Intent**: A two-screen mail app written the Angular routing way: a route table in `app.routes.ts`, a shell component hosting a `<router-outlet>`, an inbox whose rows are `routerLink`s, and a detail screen that reads its mail id from `ActivatedRoute`. A wildcard route catches the one deliberately stale link.

**Source**

`app.routes.ts` (the whole routing configuration; this is the modern standalone Angular form, the array `provideRouter(routes)` consumes, not the historical `RouterModule.forRoot` module form):

```ts
import { Routes } from '@angular/router';
import { InboxComponent } from './inbox.component';
import { MailDetailComponent } from './mail-detail.component';
import { NotFoundComponent } from './not-found.component';

export const routes: Routes = [
  { path: '', redirectTo: 'inbox', pathMatch: 'full' },
  { path: 'inbox', component: InboxComponent },
  { path: 'mail/:id', component: MailDetailComponent },
  { path: '**', component: NotFoundComponent },
];
```

`mini-mail.component.ts` and `mini-mail.component.html` (the shell is only an appbar and the outlet):

```ts
import { Component } from '@angular/core';

@Component({
  selector: 'app-mini-mail',
  templateUrl: './mini-mail.component.html',
})
export class MiniMailComponent {}
```

```html
<screen>
  <appbar title="Mini Mail"></appbar>
  <router-outlet></router-outlet>
</screen>
```

`inbox.component.html` (rows navigate with the array form of routerLink; the last row is a plain string link to a path no route declares, on purpose):

```html
<section>
  <list>
    <row *ngFor="let m of mail.mails" avatar [title]="m.from" [subtitle]="m.subject" [detail]="m.snippet" [time]="m.time" [routerLink]="['/mail', m.id]"></row>
  </list>
  <row title="Archived (old link)" detail="This folder moved away" routerLink="/archive"></row>
</section>
```

`mail-detail.component.ts` (parameters arrive through constructor injection, exactly as in Angular; the id is read once, in `ngOnInit`, from the snapshot):

```ts
import { Component } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { MailService } from './mail.service';

@Component({
  selector: 'app-mail-detail',
  templateUrl: './mail-detail.component.html',
})
export class MailDetailComponent {
  mail: any = null;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private mailService: MailService,
  ) {}

  ngOnInit() {
    this.mail = this.mailService.getById(this.route.snapshot.params.id);
  }

  backToInbox() {
    this.router.navigate(['/inbox']);
  }
}
```

The inbox and the detail share one `MailService` (the Stage 3 singleton), so the detail looks the mail up by id instead of receiving it as an input.

**What it compiles to**

Key lines of the generated `mini-mail.component.tsx`:

```tsx
const __navigator = new RgNavigator([{"path":"","redirectTo":"inbox"},{"path":"inbox"},{"path":"mail/:id"},{"path":"**"}]);
const __router = new Router(__navigator);

// A [routerLink] array becomes Router.navigate in the row's onPress;
// a string routerLink becomes navigateByUrl.
<RgRow key={m?.id ?? index} avatar title={m.from} subtitle={m.subject} detail={m.snippet} time={m.time} onPress={() => __router.navigate(['/mail', m.id])} />
<RgRow title="Archived (old link)" detail="This folder moved away" onPress={() => __router.navigateByUrl("/archive")} />

// ActivatedRoute is a compiler-owned prop the outlet supplies per mount.
export function MailDetail({ __rgRoute }: { __rgRoute?: any }) {
  const route = __rgRoute;
  const router = __router;
  // ...
  const ngOnInit = () => {
    setMail(mailService.getById(route.snapshot.params.id));
  };
}

// The shell mirrors the navigator's current entry in state; the outlet
// renders the component whose pattern matches, keyed by concrete path.
export default function MiniMail() {
  const [__route, __setRoute] = useState(__navigator.current);
  useEffect(() => __navigator.subscribe(() => __setRoute(__navigator.current)), []);
  return (
    <RgScreen>
      <RgAppbar title="Mini Mail" />
      <RgOutlet>
        {__route.routePath === "mail/:id" && (
          <MailDetail key={__route.path} __rgRoute={new ActivatedRoute(__route.params, __navigator)} />
        )}
        {/* ...one conditional per component route... */}
      </RgOutlet>
    </RgScreen>
  );
}
```

Matching is the runtime's `matchRoute`: entries are tried in declaration order, `:id` captures one segment as a string, the empty path follows its redirect, and `**` catches everything else. The generated app and the preview run the same rules (the preview's matcher is a hand mirror, parity-tested over a table of paths).

**Rules used**

- **One discovery rule.** The routes file is `app.routes.ts` next to the root component, or the file named by `rangular build --routes <file>`. It is read whenever it exists. Using an outlet, a routerLink or a Router/ActivatedRoute injection without one is a `GEN_ROUTES_MISSING` error.
- **Route components are ordinary components.** They are imported by the routes file, compiled like child components, and rendered by the outlet with no props. Data arrives through injected services and `ActivatedRoute`, never through `@Input`s from the shell.
- **Parameters are strings.** `snapshot.params.id` is `'3'`, never `3`; convert before comparing with numeric ids (`Number(id)`, as the service does here). `paramMap` is an Observable-lite that emits the current params on subscribe.
- **Same-component parameter changes remount.** The outlet keys each route component by the concrete path, so moving from `/mail/2` to `/mail/3` destroys and recreates the component and `ngOnInit` runs again with the new snapshot. This is a stated v1 simplification of Angular, which reuses the component and pushes the new value through `paramMap`.
- **Navigation from code is root-relative in v1.** `router.navigate(['/inbox'])` and `router.navigateByUrl('/inbox')` write to the one navigator; command arrays are joined with `/`. Relative-to-current-route navigation is not in this version.
- **Back is the navigator's job.** `RgNavigator.back()` pops the stack and returns false at the root. The preview shows a dashed "Preview navigation" bar with a Back button at depth 2 or more; that bar is preview chrome only, standing in for the phone's back affordance. Wiring the hardware back button belongs to the app shell and lands with the Expo scaffold in Stage 12. The bar never appears in generated code.
- **Not in this version.** Child routes and nested outlets, guards (`canActivate` and friends), resolvers, lazy loading (`loadComponent`, `loadChildren`), and `routerLinkActive`. A route entry using one of them is a `GEN_ROUTE_UNSUPPORTED` error naming the feature. `data` and `title` keys are accepted and ignored.

**Common mistakes**

- **Putting `<router-outlet>` in a child component.** Nested outlets are child routes, which are not supported yet; that is a `GEN_ROUTE_UNSUPPORTED` warning and the outlet renders empty. Keep the one outlet in the root component.
- **Writing routerLink on a component tag.** A link needs a tappable block: put it on a `<button>` or `<row>`, or handle the tap inside the component and call `this.router.navigate(...)`.
- **Expecting the detail to receive the mail as an @Input.** Route components take no inputs from the shell. Share data through a service and select it by the route parameter, as this example does.
- **Comparing a param to a number.** `params.id === 3` is never true; params are strings. Convert once, at the lookup.
- **Reading params in a field initializer.** Initializers cannot see the injected route. Read `snapshot.params` in `ngOnInit` (or subscribe to `paramMap` there), as this example does.
- **Declaring the same path twice.** The first entry wins and the second never renders; the compiler warns `GEN_ROUTE_DUPLICATE`.
- **Naming a class that is not a component in a route.** The class must be an `@Component` imported by the routes file, otherwise `GEN_ROUTE_COMPONENT`.
