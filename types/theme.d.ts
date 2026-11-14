export const THEMES: Readonly<Record<'dark' | 'light', Readonly<Record<string, string>>>>;
export function resolveTheme(name: 'light' | 'dark'): Readonly<Record<string, string>>;
