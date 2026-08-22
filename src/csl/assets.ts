import apaStyle from './styles/apa.csl';
import ieeeStyle from './styles/ieee.csl';
import chicagoAuthorDateStyle from './styles/chicago-author-date.csl';
import enUsLocale from './locales/locales-en-US.xml';

export type CslStyleId = 'apa' | 'ieee' | 'chicago-author-date';

export interface CslStyleOption {
  id: CslStyleId;
  label: string;
}

export const CSL_STYLES: CslStyleOption[] = [
  { id: 'apa', label: 'APA 7th edition' },
  { id: 'ieee', label: 'IEEE' },
  { id: 'chicago-author-date', label: 'Chicago (author-date)' },
];

const BUNDLED_STYLES: Record<CslStyleId, string> = {
  apa: apaStyle,
  ieee: ieeeStyle,
  'chicago-author-date': chicagoAuthorDateStyle,
};

/**
 * Resolve a CSL style XML string for the given style id. If a custom path is
 * provided it is preferred; otherwise the bundled copy is used.
 */
export function resolveStyleXml(
  id: CslStyleId,
  customStyleXml?: string,
): string {
  if (customStyleXml) return customStyleXml;
  return BUNDLED_STYLES[id] ?? BUNDLED_STYLES.apa;
}

/**
 * The bundled en-US locale XML string.
 */
export const BUNDLED_LOCALE_EN_US: string = enUsLocale;

/**
 * Retrieve a locale XML string for a language code.  Currently only the
 * bundled `en-US` locale is available; other languages fall back to it.
 */
export function makeLocaleRetriever(
  bundledLocale: string = BUNDLED_LOCALE_EN_US,
): (lang: string) => string {
  return (_lang: string) => bundledLocale;
}
