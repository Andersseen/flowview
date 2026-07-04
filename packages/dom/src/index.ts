export {
  compileScriptEvents,
  applyTemplateEdits,
  type CompileScriptEventsRequest,
  type CompileScriptEventsResult,
  type TemplateEdit,
} from "./compiler.js";

export {
  findEventBindings,
  type EventBinding,
  type HandlerArgument,
} from "./parser.js";

export {
  FlowmarkDomError,
  type FlowmarkDomDiagnostic,
  type FlowmarkDomLocation,
  locate,
} from "./diagnostics.js";
