# Recipe: Shared inbox — one service, two components, lifecycle

**Intent** — The Stage 2 inbox, rebuilt on a shared `MailService`: the parent screen renders the mail list from the service, a child `<unread-badge>` shows the unread count from the *same* service instance, and "Mark all read" updates both at once. The badge also demonstrates `ngOnInit`.

**Source**

`mail.service.ts`:

```ts
import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class MailService {
  mails = [
    { id: 1, from: 'Sarju', subject: 'Photos from the weekend', snippet: 'Sharing the album with you…', time: '9:12 am', unread: true },
    { id: 2, from: 'Google', subject: 'Security alert', snippet: 'A new sign-in on your device', time: '8:03 am', unread: true },
    { id: 3, from: 'Medium', subject: 'Your weekly reading list', snippet: 'Stories picked for you', time: 'Yesterday', unread: false },
    { id: 4, from: 'Awaken Me', subject: 'Build finished successfully', snippet: 'Your latest build is ready to test', time: 'Tue', unread: false },
  ];

  unreadCount() {
    return this.mails.filter((m: any) => m.unread).length;
  }

  markAllRead() {
    this.mails = this.mails.map((m: any) => {
      return { id: m.id, from: m.from, subject: m.subject, snippet: m.snippet, time: m.time, unread: false };
    });
  }
}
```

`shared-inbox.component.ts` (parent) and template:

```ts
import { Component } from '@angular/core';
import { MailService } from './mail.service';
import { UnreadBadgeComponent } from './unread-badge.component';

@Component({
  selector: 'app-shared-inbox',
  templateUrl: './shared-inbox.component.html',
})
export class SharedInboxComponent {
  constructor(private mail: MailService) {}

  markAllRead() {
    this.mail.markAllRead();
  }
}
```

```html
<screen>
  <appbar title="Mail" search="Search in mail"></appbar>
  <h1>Inbox</h1>
  <unread-badge></unread-badge>
  <list>
    <row avatar *ngFor="let m of mail.mails; let i = index" [title]="m.from" [subtitle]="m.subject" [detail]="m.snippet" [time]="m.time"><span *ngIf="m.unread">●</span></row>
  </list>
  <button (click)="markAllRead()">Mark all read</button>
</screen>
```

`unread-badge.component.ts` (child) and template:

```ts
@Component({
  selector: 'unread-badge',
  templateUrl: './unread-badge.component.html',
})
export class UnreadBadgeComponent {
  loaded = false;

  constructor(private mail: MailService) {}

  ngOnInit() {
    this.loaded = true;
  }
}
```

```html
<p *ngIf="loaded">{{ mail.unreadCount() }} unread</p>
```

**What it compiles to**

One generated file holds the service, the container and both components:

```tsx
export class MailService extends ReactiveService {
  mails = [ /* the same literal array */ ];
  unreadCount() {
    return this.mails.filter((m: any) => m.unread).length;
  }
  markAllRead() {
    this.mails = this.mails.map((m: any) => { /* ... unread: false ... */ });
    this.__notify();                       // appended after the field assignment
  }
}

const __container = new Container();
__container.register(MailService, new MailService());

export function UnreadBadge() {
  const mail = __container.get<MailService>(MailService);
  useSyncExternalStore((cb) => mail.__subscribe(cb), () => mail.__getVersion());
  const [loaded, setLoaded] = useState(false);
  const ngOnInit = () => { setLoaded(true); };
  useEffect(() => { ngOnInit(); }, []);    // ngOnInit, once after first render
  return (
    <>
      {loaded && (
        <Text variant="body">{mail.unreadCount()} unread</Text>
      )}
    </>
  );
}

export default function SharedInbox() {
  const mail = __container.get<MailService>(MailService);   // the SAME instance
  useSyncExternalStore((cb) => mail.__subscribe(cb), () => mail.__getVersion());
  // ...
}
```

**Rules used**

- **A service is a real class.** `@Injectable({ providedIn: 'root' })` classes compile to classes extending the runtime's `ReactiveService`. Fields and methods keep `this.` — service methods are translated with the same subset as component methods, but assignments stay assignments.
- **Reactivity is a version counter.** Every assignment to a service field inside a service method gets a `this.__notify()` after it. Components that inject the service subscribe with `useSyncExternalStore` over the service's version, so a notify re-renders every subscribed component — parent and badge alike. The singleton lives in a module-level `__container` in the generated file; registrations are dependency-ordered (a service's dependencies register before it).
- **Constructor DI is parameter properties only.** `constructor(private mail: MailService)` resolves the token from the declared type. Services may inject services. An unknown token is a `DI_UNKNOWN_TOKEN` error naming the fix. Constructor *bodies* of components are not translated — do setup in `ngOnInit`.
- **Lifecycle:** `ngOnInit()` → a call inside `useEffect(..., [])`; `ngOnDestroy()` → that effect's cleanup. In the preview, a component's ngOnInit runs once when its instance is first created (child instances persist across re-renders, keyed by their position in the template); the static first paint deliberately shows pre-init state.
- **HttpClient is a token like any other** (not used in this example): `constructor(private http: HttpClient)` injects the runtime client, registered in the same container. The supported call shape is `this.http.get(url).subscribe((data) => { this.field = data; });` — a block-bodied arrow whose statements assign fields. In the preview, HttpClient is a stub whose `get()` never emits (no network in previews).
- In the preview, both components and the badge share one live service object: tap "Mark all read" in `preview.html` and the badge count and the unread dots update together.

**Common mistakes**

- **Mutating items in place.** `this.mails.forEach((m) => { m.unread = false; })` changes the data but never assigns a service field, so no `__notify()` is emitted and no component re-renders. Reassign the field instead: `this.mails = this.mails.map(...)` — assignment is what notifies.
- **Injecting a service that is not `providedIn: 'root'`.** Only root-provided injectables are registered in the container. Anything else is a `DI_UNKNOWN_TOKEN` error at compile time, not a runtime surprise.
- **Doing setup in the constructor.** Component constructor bodies are not translated into the generated function component. Put one-time setup in `ngOnInit` — here the badge's `loaded` flag is exactly that pattern (it also proves the hook ran: without ngOnInit the badge never appears).
- **Reading service state without injecting.** Templates only see what the component injected (`mail.mails` works because `mail` is a constructor property of *this* component). A child that needs the service injects it itself — it gets the same singleton.
