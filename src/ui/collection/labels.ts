export const LANGUAGES: [string, string][] = [
  ['en', 'English'],
  ['fr', 'French'],
  ['de', 'German'],
  ['it', 'Italian'],
  ['pt', 'Portuguese'],
  ['es', 'Spanish'],
  ['ja', 'Japanese'],
  ['ko', 'Korean'],
  ['zh', 'Chinese'],
]
export const languageName = (code: string) => LANGUAGES.find(([c]) => c === code)?.[1] ?? code
