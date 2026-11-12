/**
 * @rangular/runtime, small pure-TypeScript helpers for generated apps.
 * EventEmitter (for @Output), a tiny signal implementation, a DI Container,
 * the ReactiveService base class generated services extend (Stage 3),
 * HttpClient, an Observable-lite wrapper over fetch (Stage 3), and the
 * forms core (Stage 8): Validators, FormControl and FormGroup, mirroring
 * @angular/forms semantics. No react or react-native imports live in this
 * file: generated components bridge services to React themselves
 * (useSyncExternalStore over __subscribe / __getVersion), so this package
 * stays environment-free and unit-testable.
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

// --- Forms (Stage 8) ---------------------------------------------------------
//
// The @angular/forms core, at the size Rangular templates can drive:
// Validators, FormControl and FormGroup, plus validateValue, the merge
// helper generated code uses for template-driven (ngModel) inputs.
// Semantics and error shapes follow Angular:
//
//   required              -> { required: true }
//   minLength(n)          -> { minlength: { requiredLength: n, actualLength: len } }
//   maxLength(n)          -> { maxlength: { requiredLength: n, actualLength: len } }
//   email                 -> { email: true }
//   pattern(p)            -> { pattern: { requiredPattern, actualValue } }
//
// As in Angular, every validator except `required` treats an empty value
// (null, undefined, '') as valid: emptiness is `required`'s job alone.
// A control is valid exactly when its merged errors object is null.

export type ValidationErrors = { [key: string]: unknown };
export type ValidatorFn = (value: unknown) => ValidationErrors | null;

function isEmptyValue(value: unknown): boolean {
  return value === null || value === undefined || value === ''
    || (Array.isArray(value) && value.length === 0);
}

function valueLength(value: unknown): number {
  if (typeof value === 'string' || Array.isArray(value)) return value.length;
  return String(value).length;
}

// Angular's own email check is a very long RFC regex; this is the same
// shape (local part, @, dotted domain, a TLD of at least two letters),
// kept readable on purpose.
const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;

/** Anchor a string pattern the way Angular does: ^ at the start, $ at the end. */
function anchorPattern(pattern: string): string {
  let out = pattern;
  if (!out.startsWith('^')) out = `^${out}`;
  if (!out.endsWith('$')) out = `${out}$`;
  return out;
}

export const Validators = {
  required(value: unknown): ValidationErrors | null {
    return isEmptyValue(value) ? { required: true } : null;
  },

  minLength(requiredLength: number): ValidatorFn {
    return (value: unknown) => {
      if (isEmptyValue(value)) return null;
      const actualLength = valueLength(value);
      return actualLength < requiredLength
        ? { minlength: { requiredLength, actualLength } }
        : null;
    };
  },

  maxLength(requiredLength: number): ValidatorFn {
    return (value: unknown) => {
      if (isEmptyValue(value)) return null;
      const actualLength = valueLength(value);
      return actualLength > requiredLength
        ? { maxlength: { requiredLength, actualLength } }
        : null;
    };
  },

  email(value: unknown): ValidationErrors | null {
    if (isEmptyValue(value)) return null;
    return EMAIL_RE.test(String(value)) ? null : { email: true };
  },

  pattern(p: string | RegExp): ValidatorFn {
    const requiredPattern = typeof p === 'string' ? anchorPattern(p) : p.source;
    const regex = typeof p === 'string' ? new RegExp(requiredPattern) : p;
    return (value: unknown) => {
      if (isEmptyValue(value)) return null;
      return regex.test(String(value))
        ? null
        : { pattern: { requiredPattern, actualValue: value } };
    };
  },
};

/** Run validators in order and merge their error objects; null when all pass. */
export function validateValue(value: unknown, validators: ValidatorFn[]): ValidationErrors | null {
  let merged: ValidationErrors | null = null;
  for (const validator of validators) {
    const errors = validator(value);
    if (errors) merged = { ...(merged ?? {}), ...errors };
  }
  return merged;
}

/**
 * One reactive form control (Stage 8). Holds a value, validates it on
 * construction and on every setValue, tracks touched/dirty the way
 * Angular does, and exposes valueChanges as an Observable-lite.
 */
export class FormControl {
  value: unknown;
  errors: ValidationErrors | null = null;
  touched = false;
  dirty = false;
  readonly valueChanges: ObservableLite<unknown>;
  private readonly validators: ValidatorFn[];
  private readonly listeners = new Set<(value: unknown) => void>();

  constructor(initialValue: unknown = null, validators?: ValidatorFn | ValidatorFn[] | null) {
    this.value = initialValue;
    this.validators = validators == null ? [] : Array.isArray(validators) ? [...validators] : [validators];
    this.valueChanges = {
      subscribe: (next?: (value: unknown) => void) => {
        if (next) this.listeners.add(next);
        return { unsubscribe: () => { if (next) this.listeners.delete(next); } };
      },
    };
    this.revalidate();
  }

  get valid(): boolean { return this.errors === null; }
  get invalid(): boolean { return this.errors !== null; }
  get pristine(): boolean { return !this.dirty; }
  get untouched(): boolean { return !this.touched; }

  setValue(value: unknown): void {
    this.value = value;
    this.dirty = true;
    this.revalidate();
    for (const listener of [...this.listeners]) listener(value);
  }

  markAsTouched(): void { this.touched = true; }
  markAsDirty(): void { this.dirty = true; }

  private revalidate(): void {
    this.errors = validateValue(this.value, this.validators);
  }
}

/**
 * A named set of FormControls (Stage 8). The group's value is the plain
 * object of control values; the group is valid exactly when every
 * control is valid. There are no group-level validators in this version,
 * so the group's own errors are always null, as in Angular when no group
 * validator is registered.
 */
export class FormGroup {
  readonly controls: Record<string, FormControl>;

  constructor(controls: Record<string, FormControl>) {
    this.controls = controls;
  }

  get(name: string): FormControl {
    return this.controls[name];
  }

  get value(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [name, control] of Object.entries(this.controls)) out[name] = control.value;
    return out;
  }

  get valid(): boolean {
    return Object.values(this.controls).every((c) => c.valid);
  }

  get invalid(): boolean { return !this.valid; }
  get errors(): ValidationErrors | null { return null; }

  get touched(): boolean {
    return Object.values(this.controls).some((c) => c.touched);
  }

  get dirty(): boolean {
    return Object.values(this.controls).some((c) => c.dirty);
  }

  markAllAsTouched(): void {
    for (const control of Object.values(this.controls)) control.markAsTouched();
  }
}
