// How a hadith grade from Dorar.net reads: sound, weak, or neither clearly (shown neutral). Gold is
// kept for grades that plainly say sound, so nothing doubtful ever looks authentic.

export type GradeTone = 'sound' | 'weak' | 'unclear';

// Arabic script, Urdu and Persian letters included. A grade word counts only as a whole word:
// «صحيحه» in «أورده مسلم في مقدمة صحيحه» is not «صحيح», and «رواه» does not hold «واه».
const LETTER = '\\u0600-\\u06FF';
const wholeWord = (words: string) => `(?<![${LETTER}])(?:${words})(?![${LETTER}])`;

// Checked first, since a denial holds the word it denies («ليس بصحيح», «ليس بالقوي»). A grade that
// criticises a narrator in the chain ("[فيه] أبو عاتكة هذا، لم أعرفه") is weak too. "لا يعرف إلا…"
// alone only says how a narration is known, so it does not count.
const WEAK = new RegExp(
  [
    'لا يصح',
    'لم يصح',
    'لا يثبت',
    'لم يثبت',
    'ليس بصحيح',
    'غير صحيح',
    'ليس ب?حديث',
    'ليس بشيء',
    'ليس بالقوي',
    'ليس بقوي',
    'لا أصل',
    'ليس له(?:ذا الحديث)? أصل',
    'موضوع',
    'باطل',
    'منكر',
    'ضعيف',
    'ضعفه',
    'ضعّفه',
    'خطأ',
    'مضطرب',
    'متروك',
    'منقطع',
    'مقلوب',
    'ساقط',
    'كذب',
    'كذاب',
    'لا يعرف(?! إلا)',
    'لم أعرفه',
    'لا يتابع',
    'ذكر من جرحه',
    'مجهول',
    wholeWord('شاذ|واه|واهٍ|معل|معلول'),
  ].join('|')
);

const SOUND = new RegExp(
  [
    wholeWord('صحيح|حسن|جيد|قوي|ثابت|ثبت'),
    'رجاله ثقات',
    'رجال الصحيح',
    'على شرط',
    'لا بأس به',
    'في صحيحه',
    'على صحته',
    'بالصحة',
  ].join('|')
);

// In a Sahih yet not held to its standard: its introduction («أورده مسلم في مقدمة صحيحه») and
// narrations quoted without their chain («علقه البخاري»).
const BELOW_SAHIH = /مقدمة|معلق|علقه/;

export const gradeTone = (grade: string): GradeTone => {
  if (WEAK.test(grade)) return 'weak';
  if (BELOW_SAHIH.test(grade)) return 'unclear';
  // "[فيه] …" names a narrator in the chain; with no word of criticism it is still no praise.
  if (SOUND.test(grade) && !/^\[?فيه/.test(grade.trim())) return 'sound';
  return 'unclear';
};
