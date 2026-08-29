export type CSL_STYLE_ID = 'apa' | 'vancouver' | 'harvard1';
export const CSL_STYLES: Record<CSL_STYLE_ID, string> = {
  apa: 'APA 7th edition',
  vancouver: 'Vancouver',
  harvard1: 'Harvard',
};

export type CSL_LANG = 'en-US' | 'es-ES' | 'de-DE' | 'fr-FR' | 'nl-NL';
export const CSL_LANGS: Record<CSL_LANG, string> = {
  'en-US': 'en-US',
  'es-ES': 'es-ES',
  'de-DE': 'de-DE',
  'fr-FR': 'fr-FR',
  'nl-NL': 'nl-NL',
};

export type CiteOptions = {
  style?: CSL_STYLE_ID;
  language?: CSL_LANG;
};
