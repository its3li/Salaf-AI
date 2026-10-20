import type { Language } from '../languages';
import { ar, type Messages } from './ar';
import { fa } from './fa';
import { ur } from './ur';

export type { Messages };

export const MESSAGES: Record<Language, Messages> = { ar, ur, fa };
