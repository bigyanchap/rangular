import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { compileComponent, hasErrors } from '../packages/compiler/src/compile';
import { renderPreview } from '../packages/compiler/src/preview/renderPreview';
import { ICON_PATHS } from '../packages/ui/src/icons';

/**
 * Gradient shell round (2026-11-17): the shell surface the
 * Rangular Tutorial redesign asked for. A pinned gradient app bar
 * with projected children (the search pill), a gradient surface, a
 * labelled section, a row with avatar text and a trailing action,
 * and the bookmark icons. Each construct must compile to a visible
 * effect in the generated code, the primitives and both preview
 * renderers; nothing in this round may drop silently.
 */

const ROOT = path.join(__dirname, '..', '..');
const primitivesSrc = fs.readFileSync(
  path.join(ROOT, 'packages', 'ui', 'src', 'primitives.tsx'), 'utf8');
const tokensSrc = fs.readFileSync(
  path.join(ROOT, 'packages', 'ui', 'src', 'tokens.ts'), 'utf8');

function compileSnippet(template: string, classBody = '') {
  const tsSource = `
    @Component({ selector: 'app-t', template: ${JSON.stringify(template)} })
    export class TComponent { ${classBody} }
  `;
  return compileComponent({ tsSource });
}

function previewOf(template: string, classBody = '') {
  const result = compileSnippet(template, classBody);
  assert.equal(hasErrors(result.diagnostics), false, JSON.stringify(result.diagnostics));
  return renderPreview(result.component!, result.ast!);
}

test('bookmark icons ship filled and outline paths', () => {
  assert.ok(ICON_PATHS['bookmark'], 'filled bookmark');
  assert.ok(ICON_PATHS['bookmark-outline'], 'outline bookmark');
  assert.ok(ICON_PATHS['bookmark'][0].includes('M17 3H7'));
});

test('brand gradient tokens carry the three stops in both themes', () => {
  const froms = tokensSrc.match(/gradientFrom: '#3b0764'/g) ?? [];
  assert.equal(froms.length, 2);
  assert.ok(tokensSrc.includes("gradientVia: '#7c3aed'"));
  assert.ok(tokensSrc.includes("gradientTo: '#db2777'"));
});

test('<gradient> compiles to RgGradient with its children', () => {
  const { code, diagnostics } = compileSnippet('<gradient><h2>Hi</h2></gradient>');
  assert.equal(hasErrors(diagnostics), false, JSON.stringify(diagnostics));
  assert.match(code, /<RgGradient>/);
  assert.match(code, /<\/RgGradient>/);
});

test('RgGradient fills with the shared gradient and lightens text roles', () => {
  assert.match(primitivesSrc, /export function RgGradient/);
  assert.match(primitivesSrc, /function GradientFill/);
  assert.match(primitivesSrc, /text: t\.colors\.onPrimary/);
});

test('preview paints the gradient surface and its CSS', () => {
  const html = previewOf('<gradient><h2>Hi</h2></gradient>');
  assert.match(html, /class="gradient"/);
  assert.ok(html.includes('linear-gradient(115deg, #3b0764, #7c3aed 52%, #db2777)'));
});

test('gradient pinned app bar compiles tone, pin and the projected search input', () => {
  const tpl = '<appbar title="Lessons" tone="gradient" pin menu (menu)="open()" titleAlign="center">'
    + '<input variant="search" placeholder="Search" [(ngModel)]="q"></appbar>';
  const { code, diagnostics } = compileSnippet(tpl, "q = ''; open() {}");
  assert.equal(hasErrors(diagnostics), false, JSON.stringify(diagnostics));
  assert.match(code, /tone="gradient"/);
  assert.match(code, /\bpin\b/);
  assert.match(code, /<RgInput/);
  assert.match(code, /variant="search"/);
});

test('RgAppbar registers a pinned bar into the screen header slot', () => {
  assert.match(primitivesSrc, /RgHeaderSlotContext/);
  assert.match(primitivesSrc, /slot\.register\(pinKey, bar, chrome\)/);
  assert.match(primitivesSrc, /headerNode/);
});

test('preview paints the gradient pin bar with children under the row', () => {
  const tpl = '<appbar title="Lessons" tone="gradient" pin menu (menu)="open()">'
    + '<input variant="search" placeholder="Search" [(ngModel)]="q"></appbar>';
  const html = previewOf(tpl, "q = ''; open() {}");
  assert.match(html, /appbar gradient pin has-children/);
  assert.match(html, /appbar-children/);
  assert.match(html, /input-search/);
});

test('app bar back and action compile to known event props', () => {
  const tpl = '<appbar title="Lesson 4" back (back)="go()" '
    + '[actionIcon]="saved ? \'bookmark\' : \'bookmark-outline\'" (action)="toggle()"></appbar>';
  const { code, diagnostics } = compileSnippet(tpl, 'saved = false; go() {} toggle() {}');
  assert.equal(hasErrors(diagnostics), false, JSON.stringify(diagnostics));
  assert.match(code, /onBack=/);
  assert.match(code, /onAction=/);
  assert.ok(!code.includes('has no standard RN prop'), code);
});

test('preview paints the app bar back chevron and action icon', () => {
  const html = previewOf('<appbar title="Lesson 4" back actionIcon="bookmark-outline"></appbar>');
  assert.match(html, /appbar-action/);
  assert.ok(html.includes('M17 3H7'), 'bookmark path paints');
});

test('search pill input paints in the preview with the search icon', () => {
  const html = previewOf(
    '<input variant="search" placeholder="Search lessons" [(ngModel)]="q">', "q = '';");
  assert.match(html, /input-search/);
  assert.match(primitivesSrc, /variant === 'search'/);
  assert.match(primitivesSrc, /styles\.inputPill/);
});

test('row compiles avatarText and the action event', () => {
  const tpl = '<row avatar avatarText="41" title="Forms" '
    + '[actionIcon]="saved ? \'bookmark\' : \'bookmark-outline\'" (action)="toggle()" (click)="open()"></row>';
  const { code, diagnostics } = compileSnippet(tpl, 'saved = false; toggle() {} open() {}');
  assert.equal(hasErrors(diagnostics), false, JSON.stringify(diagnostics));
  assert.match(code, /avatarText="41"/);
  assert.match(code, /onAction=/);
  assert.ok(!code.includes('has no standard RN prop'), code);
});

test('preview paints the row number tile and bookmark button', () => {
  const tpl = '<row avatar avatarText="41" title="Forms" actionIcon="bookmark-outline" (action)="toggle()"></row>';
  const html = previewOf(tpl, 'toggle() {}');
  assert.match(html, />41<\/span>/);
  assert.match(html, /row-action/);
  assert.ok(html.includes('M17 3H7'), 'bookmark path paints');
  assert.match(primitivesSrc, /styles\.rowAction/);
  assert.match(primitivesSrc, /avatarLabel/);
});

test('labelled section compiles label and meta onto RgSection', () => {
  const { code, diagnostics } = compileSnippet(
    '<section label="Your bookmarks" meta="2 saved"><p>Body</p></section>');
  assert.equal(hasErrors(diagnostics), false, JSON.stringify(diagnostics));
  assert.match(code, /<RgSection/);
  assert.match(code, /label="Your bookmarks"/);
  assert.match(code, /meta="2 saved"/);
});

test('preview paints the labelled section gradient bar header', () => {
  const html = previewOf('<section label="Your bookmarks" meta="2 saved"><p>Body</p></section>');
  assert.match(html, /section-head/);
  assert.match(html, /section-bar/);
  assert.ok(html.includes('Your bookmarks'));
  assert.ok(html.includes('2 saved'));
});

test('an unlabelled section paints no header', () => {
  const html = previewOf('<section><p>Body</p></section>');
  assert.ok(!html.includes('<div class="section-head">'));
});

// --- Gmail light round (2026-11-17) --------------------------------
// Bigyan's phone feedback on the gradient shell: he asked to try
// the Gmail light design instead, for the keyboard to stop hiding
// the field (content moves up, a Done button on the keyboard),
// for lesson pages to open at the top, for back to stop jittering,
// and for a switch to answer with a haptic, as an opt-in attribute
// so a switch can be built with it or without it.

function compileExample(name: string) {
  const dir = path.join(ROOT, 'examples', name);
  const entry = path.join(dir, `${name}.component.ts`);
  return compileComponent({
    tsSource: fs.readFileSync(entry, 'utf8'),
    fileName: entry,
    resolveFile: (rel: string) => {
      const p = path.join(dir, rel);
      return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : undefined;
    },
    resolveImport: (spec: string, importer: string) => {
      const base = path.resolve(path.dirname(importer), spec);
      for (const cand of [base, `${base}.ts`]) {
        if (fs.existsSync(cand)) return { source: fs.readFileSync(cand, 'utf8'), fileName: cand };
      }
      return undefined;
    },
  });
}

const bodyOf = (html: string) => (html.split('</style>')[1] ?? html).split('<script>')[0];

test('appbar tone plain compiles through and paints in the preview', () => {
  const { code, diagnostics } = compileSnippet('<appbar title="Inbox" tone="plain" pin></appbar>');
  assert.equal(hasErrors(diagnostics), false, JSON.stringify(diagnostics));
  assert.ok(code.includes('tone="plain"'));
  assert.ok(bodyOf(previewOf('<appbar title="Inbox" tone="plain" pin></appbar>')).includes('appbar plain'));
});

test('a bar whose face is a child paints no empty title row', () => {
  const tpl = '<appbar pin tone="plain"><input variant="search" placeholder="Search lessons" [value]="q" (change)="onQ($event)"></appbar>';
  const body = bodyOf(previewOf(tpl, "q = ''; onQ(v: string) {}"));
  assert.ok(body.includes('input-search'), 'the pill child paints');
  assert.ok(!body.includes('appbar-title'), 'no empty title row above the pill');
  assert.ok(primitivesSrc.includes('hasRow'), 'RgAppbar skips the empty row too');
});

test('search pill leading icon and avatar compile, wire and paint', () => {
  const tpl = '<input variant="search" leadingIcon="menu" avatarText="R" placeholder="Search lessons" [value]="q" (change)="onQ($event)" (leading)="open()">';
  const { code, diagnostics } = compileSnippet(tpl, "q = ''; onQ(v: string) {} open() {}");
  assert.equal(hasErrors(diagnostics), false, JSON.stringify(diagnostics));
  assert.ok(code.includes('leadingIcon="menu"'));
  assert.ok(code.includes('avatarText="R"'));
  assert.ok(code.includes('onLeading'), '(leading) wires to onLeading');
  const body = bodyOf(previewOf(tpl, "q = ''; onQ(v: string) {} open() {}"));
  assert.ok(body.includes('pill-avatar'), 'the avatar initial paints in the pill');
  assert.ok(body.includes(ICON_PATHS['menu'][0]), 'the leading icon is the menu glyph');
});

test('switch haptic is opt-in: the attribute compiles, the primitive fires it, the preview vibrates', () => {
  const { code, diagnostics } = compileSnippet(
    '<switch haptic [checked]="on" (change)="flip($event)">Wi-Fi</switch>',
    'on = true; flip(v: boolean) {}');
  assert.equal(hasErrors(diagnostics), false, JSON.stringify(diagnostics));
  assert.ok(code.includes('haptic'), 'the haptic attribute reaches RgSwitch');
  const silent = compileSnippet(
    '<switch [checked]="on" (change)="flip($event)">Wi-Fi</switch>',
    'on = true; flip(v: boolean) {}');
  assert.ok(!silent.code.includes('haptic'), 'a switch without the attribute stays silent');
  assert.ok(primitivesSrc.includes("require('expo-haptics')"), 'RgSwitch requires expo-haptics lazily');
  assert.ok(primitivesSrc.includes('selectionAsync'), 'the haptic is a selection haptic');
  const html = previewOf('<switch haptic [checked]="on" (change)="flip($event)">Wi-Fi</switch>',
    'on = true; flip(v: boolean) {}');
  assert.ok(html.includes('navigator.vibrate'), 'the live preview answers with a vibrate');
});

test('section chip and plain headers paint in the preview', () => {
  const chip = bodyOf(previewOf('<section label="Continue" icon="play" meta="Lesson 4 of 95"><p>x</p></section>'));
  assert.ok(chip.includes('section-chip'), 'the icon chip paints');
  assert.ok(chip.includes(ICON_PATHS['play'][0]), 'the chip carries the play glyph');
  const plain = bodyOf(previewOf('<section label="Getting started" plain><p>x</p></section>'));
  assert.ok(plain.includes('section-title'), 'the plain header keeps its title');
  assert.ok(!plain.includes('section-bar') && !plain.includes('section-chip'), 'the plain header has no decoration');
});

test('row icon and varied avatar tones paint in the preview', () => {
  const iconRow = bodyOf(previewOf('<row icon="home" title="Home"></row>'));
  assert.ok(iconRow.includes(ICON_PATHS['home'][0]), 'the leading icon paints');
  const varied = bodyOf(previewOf('<row avatar avatarText="7" avatarTone="varied" title="Lesson 7"></row>'));
  assert.ok(varied.includes('background:#e8f0fe'), 'the varied tone paints its pastel pair');
});

test('the keyboard contract lives in the shipped screen and fields', () => {
  assert.ok(primitivesSrc.includes('KeyboardAvoidingView'), 'the screen avoids the keyboard');
  assert.ok(primitivesSrc.includes('keyboardShouldPersistTaps'), 'taps persist while the keyboard is up');
  assert.ok(primitivesSrc.includes('InputAccessoryView'), 'fields carry the iOS Done bar');
  assert.ok(primitivesSrc.includes('Keyboard.dismiss'), 'Done dismisses the keyboard');
  assert.ok(primitivesSrc.includes('useLayoutEffect'), 'the pinned bar registers before paint, no jitter');
});

test('a routed app keys its entry screen by the concrete path', () => {
  const result = compileExample('mini-mail');
  assert.equal(hasErrors(result.diagnostics), false, JSON.stringify(result.diagnostics));
  assert.ok(result.code!.includes('<RgScreen key={__route.path}>'),
    'the entry screen remounts per route, so each screen opens at the top');
});

// --- The spacing rule round (2026-11-17) --------------------------------
// Material's floor, the way Angular Material implements it: two
// touch targets never touch (8dp minimum), stacked controls sit at
// the one rhythm gap (spacing.md), and the CONTAINER owns the gap.
// The audit that forced this found a form's Save and Clear buttons
// stacked at gap 0 because <form> compiled to a bare View, and a
// stepper's step page with its buttons touching for the same
// reason. Every stack container now carries the rhythm gap itself.

test('spacing rule: a form compiles to the stack primitive, not a bare view', () => {
  const result = compileSnippet(
    '<form (submit)="save()"><input label="Name"><button type="submit">Save</button><button (click)="clear()">Clear</button></form>',
    'save() {} clear() {}',
  );
  assert.equal(hasErrors(result.diagnostics), false, JSON.stringify(result.diagnostics));
  assert.ok(result.code!.includes('<RgSection'), 'the form renders as RgSection, the gapped stack');
});

test('spacing rule: every stack container in the primitives owns the rhythm gap', () => {
  for (const style of ['dialogPanel', 'sheetPanel', 'drawerPanel', 'tabPanel', 'stepPanel']) {
    const body = primitivesSrc.split(style + ': {')[1].split('},')[0];
    assert.ok(body.includes('gap: t.spacing.md'), style + ' carries the rhythm gap');
  }
  const panelBody = primitivesSrc.split('panelBody: {')[1].split('},')[0];
  assert.ok(panelBody.includes('gap: t.spacing.md'), 'the accordion panel body carries the rhythm gap');
});

test('overlays register into the screen overlay slot while open', () => {
  // The slot exists, the screen provides it and draws the
  // registered overlays above the scroll content.
  assert.ok(primitivesSrc.includes('const RgOverlaySlotContext = createContext'), 'the overlay slot exists');
  assert.ok(primitivesSrc.includes('<RgOverlaySlotContext.Provider value={overlaySlot}>'), 'the screen provides the slot');
  assert.ok(primitivesSrc.includes('{overlayNodes}'), 'the screen draws the registered overlays');
  // Registration is keyed on the tree content, so a repeat
  // registration with the same key cannot loop.
  assert.ok(primitivesSrc.includes('if (cur && cur.key === key) return prev;'), 'registration is keyed');
  // All four overlays route their tree through the slot while
  // open, and the datetime picker rides on the sheet.
  assert.equal((primitivesSrc.match(/const slotted = useRgOverlay\(tree, isOpen\);/g) ?? []).length, 4, 'dialog, sheet, drawer and lightbox use the slot');
  assert.ok(primitivesSrc.includes('return slotted ? null : tree;'), 'a slotted overlay renders nothing in place');
});

test('spacing rule: the preview mirrors the container gaps', () => {
  const html = previewOf('<form (submit)="save()"><button type="submit">Save</button></form><tabs><tab label="One"><p>First</p><button>Go</button></tab></tabs>', 'save() {}');
  const css = html.split('</style>')[0];
  assert.ok(/\.form \{[^}]*gap: 12px/.test(css), 'the preview form carries the rhythm gap');
  assert.ok(css.includes('.tab-panel { display: flex; flex-direction: column; gap: 12px; }'), 'the preview tab panel carries the rhythm gap');
  const body = html.split('</style>')[1].split('<script>')[0];
  assert.ok(body.includes('class="tab-panel"'), 'tab content renders inside the panel');
});

test('the bottom slot lets a routed tab bar pin under the scroll (Option A round)', () => {
  assert.ok(primitivesSrc.includes('const RgBottomSlotContext'), 'the screen lends a bottom slot');
  assert.ok(primitivesSrc.includes('function useRgBottom'), 'bottom nav registers through the hook');
  assert.ok(primitivesSrc.includes('{bottomNode}'), 'the screen renders the registered bar');
  assert.ok(primitivesSrc.includes('slotted ? null : tree'), 'RgBottomNav renders in place only outside a screen');
  assert.ok(primitivesSrc.includes('navItemIconWrapSelected'), 'the selected tab icon carries the pill');
});

test('appbar tint, second action and progress compile and paint (Option A round)', () => {
  const tpl = '<appbar title="Rangular" tone="tint" pin menu (menu)="open()" actionIcon="search" (action)="goSearch()" actionIcon2="bookmark" (action2)="goSaved()" [progress]="pct"></appbar>';
  const cls = 'pct = 30; open() {} goSearch() {} goSaved() {}';
  const { code, diagnostics } = compileSnippet(tpl, cls);
  assert.equal(hasErrors(diagnostics), false, JSON.stringify(diagnostics));
  assert.ok(code.includes('tone="tint"'), 'the tint tone compiles through');
  assert.ok(code.includes('actionIcon2="bookmark"'), 'the second action compiles through');
  assert.ok(code.includes('progress={pct}'), 'the progress binding compiles through');
  const body = bodyOf(previewOf(tpl, cls));
  assert.ok(body.includes('appbar tint'), 'the preview paints the tint band');
  assert.ok(body.includes('appbar-progress'), 'the preview paints the progress line');
  assert.ok(body.includes('width:30%'), 'the preview paints the progress width');
  assert.ok(previewOf(tpl, cls).includes('nav-item.selected .nav-item-icon'), 'the page shell carries the selected tab pill css');
});

test('the chrome blend, fade veil and pill touch box are in the shipped primitives (Option A round)', () => {
  assert.ok(primitivesSrc.includes('chrome ? { backgroundColor: chrome } : null'), 'the safe area takes the bar colour');
  assert.ok(primitivesSrc.includes("const chrome = tint ? c.surfaceVariant : plain ? c.background : undefined"), 'flat bands lend their colour');
  assert.ok(primitivesSrc.includes('VEIL_STEPS'), 'the fade veil strips exist');
  assert.ok(primitivesSrc.includes('onEndReached || fade ? handleScroll : undefined'), 'the screen tracks scroll when fading');
  assert.ok(primitivesSrc.includes('inputPillLeading'), 'the pill leading button has a full touch box');
  const { code, diagnostics } = compileSnippet('<screen fade><p>Hi</p></screen>');
  assert.equal(hasErrors(diagnostics), false, JSON.stringify(diagnostics));
  assert.ok(code.includes('fade'), 'the screen fade attribute compiles through');
});

test('a selected row compiles and paints its pill (Option A round)', () => {
  const tpl = '<row title="Learn" icon="home" [selected]="here"></row>';
  const { code, diagnostics } = compileSnippet(tpl, 'here = true;');
  assert.equal(hasErrors(diagnostics), false, JSON.stringify(diagnostics));
  assert.ok(code.includes('selected={here}'), 'the selected binding compiles through');
  assert.ok(bodyOf(previewOf(tpl, 'here = true;')).includes('row selected'), 'the preview paints the selected pill');
  assert.ok(primitivesSrc.includes('rowSelected'), 'RgRow carries the selected style');
});

test('a named avatar tone paints its pair in the preview (Option A round)', () => {
  const body = bodyOf(previewOf('<row avatar avatarText="3" avatarTone="green" title="Done lesson"></row>'));
  assert.ok(body.includes('background:#e6f4ea;color:#137333'), 'the green pair paints');
  assert.ok(primitivesSrc.includes('AVATAR_TONE_NAMES[avatarTone]'), 'RgRow resolves named tones');
});
