import * as vscode from "vscode";
import { activateWithApi } from "./extension-core.mjs";

export function activate(context) {
  activateWithApi(context, vscode);
}

export function deactivate() {}
