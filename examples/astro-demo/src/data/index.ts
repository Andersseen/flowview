/**
 * Centralized data layer for the Flowmark landing page.
 *
 * Each exported `*Context` object is designed to be passed to a
 * `<template flowmark={context} is:raw>` region. See the
 * component files in `src/components/` for concrete usage.
 */

export * from "./types";
export { exampleSectionContext } from "./exampleSection";
export { featuresContext } from "./features";
export { footerContext } from "./footer";
export { gettingStartedContext } from "./gettingStarted";
export { heroContext } from "./hero";
export { navItems } from "./navigation";
export { site } from "./site";
export { syntaxContext } from "./syntaxExamples";
