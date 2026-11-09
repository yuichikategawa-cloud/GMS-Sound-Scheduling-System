/// <reference lib="deno.ns" />

const component = await Deno.readTextFile("src/app/components/MobileNavigation.tsx");

Deno.test("mobile More navigation supports dialog semantics, Escape and keyboard focus containment", () => {
  for (const fragment of [
    'role="dialog"',
    'aria-modal="true"',
    'aria-labelledby="mobile-more-heading"',
    'aria-controls="mobile-more-menu"',
    'event.key === "Escape"',
    'event.shiftKey && document.activeElement === first',
    'document.activeElement === last',
    'trigger?.focus()',
    'focusable()?.[0]?.focus()',
  ]) {
    if (!component.includes(fragment)) throw new Error("Mobile More menu is missing keyboard/accessibility behavior: " + fragment);
  }
});
