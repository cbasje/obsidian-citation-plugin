// Allow raw string imports of CSL style (.csl) and locale (.xml) files.
declare module '*.csl' {
  const content: string;
  export default content;
}

declare module '*.xml' {
  const content: string;
  export default content;
}
