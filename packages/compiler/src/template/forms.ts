import { ElementNode } from './ast';

/**
 * Template-side forms extraction (Stage 8), shared by codegen and the
 * preview renderer so both read an <input> the same way: which ngModel
 * binding it carries, and which validators its attributes declare.
 */

export interface NgModelBinding {
  /** 'twoWay' for [(ngModel)], 'pair' for [ngModel] (+ (ngModelChange)). */
  mode: 'twoWay' | 'pair';
  expression: string;
}

/** The ngModel binding of an element, when it has one. */
export function ngModelBindingOf(el: ElementNode): NgModelBinding | undefined {
  const twoWay = el.twoWayBindings.find((b) => b.name === 'ngModel');
  if (twoWay) return { mode: 'twoWay', expression: twoWay.expression };
  const pair = el.propBindings.find((b) => b.name === 'ngModel');
  if (pair) return { mode: 'pair', expression: pair.expression };
  return undefined;
}

/** True when the element carries any ngModel surface ([(ngModel)], [ngModel], (ngModelChange)). */
export function hasNgModelSurface(el: ElementNode): boolean {
  return !!ngModelBindingOf(el) || el.eventBindings.some((b) => b.name === 'ngModelChange');
}

export type ValidatorName = 'required' | 'minLength' | 'maxLength' | 'email' | 'pattern';

export interface ValidatorSpec {
  fn: ValidatorName;
  /**
   * Generated-code source for the validator's argument: a literal for a
   * static attribute (`3`, `"a+"` for pattern), or the binding expression
   * for a [minlength]-style binding. Absent for argument-free validators.
   */
  argSource?: string;
}

const VALIDATOR_ORDER: ValidatorName[] = ['required', 'minLength', 'maxLength', 'email', 'pattern'];

/**
 * The validators an <input> declares as attributes, in Angular's style:
 * `required` and `email` are boolean attributes, `minlength`,
 * `maxlength` and `pattern` carry a value (static attribute or binding).
 * `type="email"` is NOT a validator in Angular and is not one here.
 */
export function validatorsOf(el: ElementNode): ValidatorSpec[] {
  const specs: ValidatorSpec[] = [];
  const argOf = (attr: string, binding: string): string | undefined => {
    const b = el.propBindings.find((x) => x.name === binding);
    if (b) return b.expression;
    const raw = el.attrs[attr];
    if (raw === undefined) return undefined;
    return binding === 'pattern' ? JSON.stringify(raw) : raw;
  };
  if (el.booleanAttrs.includes('required')
    || (el.attrs['required'] !== undefined && el.attrs['required'] !== 'false')) {
    specs.push({ fn: 'required' });
  }
  const min = argOf('minlength', 'minlength');
  if (min !== undefined) specs.push({ fn: 'minLength', argSource: min });
  const max = argOf('maxlength', 'maxlength');
  if (max !== undefined) specs.push({ fn: 'maxLength', argSource: max });
  if (el.booleanAttrs.includes('email')
    || (el.attrs['email'] !== undefined && el.attrs['email'] !== 'false')) {
    specs.push({ fn: 'email' });
  }
  const pattern = argOf('pattern', 'pattern');
  if (pattern !== undefined) specs.push({ fn: 'pattern', argSource: pattern });
  return specs.sort(
    (a, b) => VALIDATOR_ORDER.indexOf(a.fn) - VALIDATOR_ORDER.indexOf(b.fn),
  );
}

/** The component field an ngModel expression targets, when it is a plain identifier. */
export function plainFieldOf(expression: string): string | undefined {
  const trimmed = expression.trim();
  return /^[A-Za-z_$][\w$]*$/.test(trimmed) ? trimmed : undefined;
}
