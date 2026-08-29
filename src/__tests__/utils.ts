import type { TFile } from "obsidian";
import type { FileType } from "../types";

class MockFile {
  parent: undefined;

  constructor(
    public name: string,
    public extension: FileType,
  ) { }
}

export function buildFile(type: FileType) {
  const f = new MockFile('library', type);
  return f as TFile;
}
