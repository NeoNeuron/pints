import { marked } from "../vendor/marked.esm.js";
import createDOMPurify from "../vendor/purify.es.mjs";
import { renderAbstract, renderPage } from "./markdown-render-utils.mjs";

const purify = createDOMPurify(window);
const deps = {
  parse: (src) => marked.parse(src),
  sanitize: (html, config) => purify.sanitize(html, config),
};

export const renderPageHtml = (src) => renderPage(src, deps);
export const renderAbstractHtml = (src) => renderAbstract(src, deps);
