/**
 * @rangular/runtime — small pure-TypeScript helpers for generated apps.
 * Stage 0+1 scope: EventEmitter (for @Output), a tiny signal implementation
 * (the reactivity primitive the codegen will bridge to React state in a later
 * stage), and a DI Container (providers -> registry, later bridged to React
 * Context). No react-native imports live in this file.
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
