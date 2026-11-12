/**
 * @rangular/runtime, small pure-TypeScript helpers for generated apps.
 * EventEmitter (for @Output), a tiny signal implementation, a DI Container,
 * the ReactiveService base class generated services extend (Stage 3), and
 * HttpClient, an Observable-lite wrapper over fetch (Stage 3). No react or
 * react-native imports live in this file: generated components bridge
 * services to React themselves (useSyncExternalStore over __subscribe /
 * __getVersion), so this package stays environment-free and unit-testable.
 */

export type Listener<T> = (value: T) => void;

export class EventEmitter<T = void> {
  private listeners = new Set<Listener<T>>();

  /** Subscribe; returns an unsubscribe function. */
  on(listener: Listener<T>): () => void {
    this.listeners.add(listener);
    return () => this.off(listener);
  }

  /** Alias matching the Angular/RxJS-flavoured naming generated code expects. */
  subscribe(listener: Listener<T>): () => void {
    return this.on(listener);
  }

  off(listener: Listener<T>): void {
    this.listeners.delete(listener);
  }

  emit(value: T): void {
    // Copy first: a listener may unsubscribe itself while emitting.
    for (const listener of [...this.listeners]) listener(value);
  }

  get listenerCount(): number {
    return this.listeners.size;
  }
}

export interface Signal<T> {
  get(): T;
  set(value: T): void;
  update(fn: (value: T) => T): void;
  subscribe(listener: Listener<T>): () => void;
  readonly value: T;
}

/** A minimal signal: a value plus change subscribers (Object.is comparison). */
export function signal<T>(initial: T): Signal<T> {
  let current = initial;
  const listeners = new Set<Listener<T>>();
  const notify = () => { for (const l of [...listeners]) l(current); };
  return {
    get: () => current,
    set(value: T) {
      if (Object.is(value, current)) return;
      current = value;
      notify();
    },
    update(fn: (value: T) => T) {
      this.set(fn(current));
    },
    subscribe(listener: Listener<T>) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    get value() { return current; },
  };
}

/**
 * Pipe helper referenced by generated code for `expr | pipeName` template
 * expressions. Only identity-safe built-ins are implemented in Stage 0+1;
 * unknown pipes return the value unchanged.
 */
export function pipe<T>(name: string, value: T, ...args: unknown[]): unknown {
  switch (name) {
    case 'uppercase': return typeof value === 'string' ? value.toUpperCase() : value;
    case 'lowercase': return typeof value === 'string' ? value.toLowerCase() : value;
    case 'json': return JSON.stringify(value);
    case 'async': return value; // Stage 3 will bridge Observables to state.
    default: void args; return value;
  }
}

/**
 * Base class for generated services (Stage 3, M6).
 *
 * A service's state is plain class fields. Whenever a translated service
 * method assigns a field, the codegen appends `this.__notify()`; subscribed
 * components re-render. Generated components subscribe with React's
 * useSyncExternalStore over __subscribe/__getVersion, the version counter
 * is the snapshot, so every notification produces a new snapshot value.
 */
export class ReactiveService {
  private __listeners = new Set<() => void>();
  private __version = 0;

  /** Bump the version and notify every subscribed component. */
  protected __notify(): void {
    this.__version++;
    for (const listener of [...this.__listeners]) listener();
  }

  /** Subscribe to changes; returns an unsubscribe function. */
  __subscribe(listener: () => void): () => void {
    this.__listeners.add(listener);
    return () => { this.__listeners.delete(listener); };
  }

  /** Monotonic snapshot for useSyncExternalStore. */
  __getVersion(): number {
    return this.__version;
  }
}

export interface Subscription {
  unsubscribe(): void;
}

/**
 * The smallest useful Observable shape: subscribe with a next and/or error
 * callback, get back a Subscription. No operators, pipelines are Stage 4+.
 */
export interface ObservableLite<T> {
  subscribe(next?: (value: T) => void, error?: (err: unknown) => void): Subscription;
}

/** The slice of fetch HttpClient needs, injectable so tests never touch the network. */
export type FetchLike = (url: string) => Promise<{ json(): Promise<unknown> }>;

/**
 * Angular-shaped HttpClient over fetch (Stage 3, M6). Registered in the
 * generated app's container under its own class token, so components inject
 * it exactly like a service: `constructor(private http: HttpClient)`.
 * Responses are parsed as JSON (Angular's default responseType).
 */
export class HttpClient {
  constructor(private fetchImpl: FetchLike = (url: string) => fetch(url)) {}

  get<T = unknown>(url: string): ObservableLite<T> {
    const fetchImpl = this.fetchImpl;
    return {
      subscribe(next?: (value: T) => void, error?: (err: unknown) => void): Subscription {
        let cancelled = false;
        fetchImpl(url)
          .then((res) => res.json())
          .then((data) => { if (!cancelled) next?.(data as T); })
          .catch((err) => { if (!cancelled) error?.(err); });
        return { unsubscribe: () => { cancelled = true; } };
      },
    };
  }
}

export type Token = string | symbol | Function;

/**
 * A tiny dependency-injection registry. Generated apps register providers
 * under a token and components resolve them with get(). A later stage bridges
 * this to React Context; the registry semantics stay the same.
 */
export class Container {
  private providers = new Map<Token, unknown>();

  register<T>(token: Token, instance: T): this {
    this.providers.set(token, instance);
    return this;
  }

  has(token: Token): boolean {
    return this.providers.has(token);
  }

  get<T>(token: Token): T {
    if (!this.providers.has(token)) {
      const name = typeof token === 'function' ? token.name : String(token);
      throw new Error(`Rangular DI: no provider registered for token '${name}'`);
    }
    return this.providers.get(token) as T;
  }
}
