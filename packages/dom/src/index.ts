export {
  compileEvents,
  type CompileEventsRequest,
  type CompileEventsResult,
} from "./compiler.js";

export {
  findEventBindings,
  extractFrontmatterFunctions,
  type EventBinding,
  type FrontmatterFunction,
  type HandlerArgument,
} from "./parser.js";

export {
  FlowmarkDomError,
  type FlowmarkDomDiagnostic,
  type FlowmarkDomLocation,
  locate,
} from "./diagnostics.js";
