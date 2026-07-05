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
  FlowviewDomError,
  type FlowviewDomDiagnostic,
  type FlowviewDomLocation,
  locate,
} from "./diagnostics.js";

export { hashScope } from "./scope.js";
