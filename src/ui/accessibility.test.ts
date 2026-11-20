import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { DominoSky } from "./DominoSky";

it("connects the keyboard shortcut and accessible labels to unique targets", () => {
  const markup = renderToStaticMarkup(createElement(DominoSky));
  const ids = [...markup.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
  expect(new Set(ids).size).toBe(ids.length);
  for (const label of markup.matchAll(/aria-labelledby="([^"]+)"/g)) {
    for (const id of label[1].split(" ")) expect(ids).toContain(id);
  }
  expect(markup).toContain('href="#disp-h"');
  expect(markup).toMatch(/<h2[^>]*id="disp-h"[^>]*tabindex="-1"/i);
  expect(markup).toContain('<th scope="row">Passengers stranded</th>');
  expect(markup.match(/<h1\b/g)).toHaveLength(1);
});
