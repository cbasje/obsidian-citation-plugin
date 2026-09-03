// Jest mock for the 'obsidian' module. The npm package is types-only
// ("main": ""), so jest cannot resolve it at runtime; tests only need the
// small API surface used by the modules under test.

class TAbstractFile {
  constructor() {
    this.path = '';
    this.name = '';
    this.parent = null;
  }
}

class TFile extends TAbstractFile {
  constructor(name, extension) {
    super();
    this.name = name;
    this.extension = extension;
    this.basename = extension ? name.slice(0, -(extension.length + 1)) : name;
  }
}

class TFolder extends TAbstractFile {}

class Notice {
  constructor() {}
}

function normalizePath(path) {
  return path.replace(/([\\/])+/g, '/').replace(/(^\/|\/$)/g, '');
}

module.exports = {
  TAbstractFile,
  TFile,
  TFolder,
  Notice,
  normalizePath,
};
